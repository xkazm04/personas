//! Curated, per-project MCP connectors for build turns (C8). The user toggles
//! these in Studio; enabled ones are written into a temp mcp-config that the
//! build turn's CLI spawn loads via `--mcp-config`. Each is a small npx package.

// Pinned ON PURPOSE for supply-chain safety. A build turn can edit the project,
// so it must not resolve "whatever the registry serves right now" for code it
// runs. To bump: re-run `npm view <pkg> version`, read the changelog for the
// jump, then change the const and nothing else (tests assert exact versions).
/// `@playwright/mcp` version run inside build turns.
pub(super) const PLAYWRIGHT_MCP_VERSION: &str = "0.0.83";
/// `@upstash/context7-mcp` version run inside build turns.
pub(super) const CONTEXT7_MCP_VERSION: &str = "4.4.4";
/// `create-next-app` version used by the scaffold (see `project.rs`).
pub(super) const CREATE_NEXT_APP_VERSION: &str = "16.4.2";

/// `(command, args)` for each curated connector id we expose. `-y` stays: npx
/// in a spawned MCP server has no TTY to confirm installing the pinned package.
fn entry(id: &str) -> Option<(&'static str, Vec<String>)> {
    match id {
        // Up-to-date, version-correct library / framework docs.
        "context7" => Some((
            "npx",
            vec![
                "-y".into(),
                format!("@upstash/context7-mcp@{CONTEXT7_MCP_VERSION}"),
            ],
        )),
        // Drive a real browser to check the rendered page.
        "playwright" => Some((
            "npx",
            vec![
                "-y".into(),
                format!("@playwright/mcp@{PLAYWRIGHT_MCP_VERSION}"),
            ],
        )),
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
                    personas_core::mcp_config::McpServer::stdio(cmd, args),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pinned(arg: &str) -> bool {
        // `@scope/name@x.y.z`: a second `@` followed by a bare semver.
        let Some((_, ver)) = arg.rsplit_once('@').filter(|(n, _)| !n.is_empty()) else {
            return false;
        };
        let parts: Vec<_> = ver.split('.').collect();
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
    }

    #[test]
    fn curated_connectors_are_pinned_to_exact_versions() {
        let cfg = build_config(&["context7".into(), "playwright".into()]).unwrap();
        let servers = cfg["mcpServers"].as_object().unwrap();
        assert_eq!(servers.len(), 2);
        for (id, srv) in servers {
            let args: Vec<&str> = srv["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a.as_str().unwrap())
                .collect();
            let pkg = args.iter().find(|a| a.starts_with('@')).unwrap();
            assert!(pinned(pkg), "{id}: {pkg} is not an exact @x.y.z pin");
            assert!(
                !args.iter().any(|a| a.contains("latest")),
                "{id}: floats on latest"
            );
        }
        assert_eq!(
            servers["playwright"]["args"][1],
            format!("@playwright/mcp@{PLAYWRIGHT_MCP_VERSION}")
        );
        assert_eq!(
            servers["context7"]["args"][1],
            format!("@upstash/context7-mcp@{CONTEXT7_MCP_VERSION}")
        );
    }

    #[test]
    fn create_next_app_const_is_exact() {
        assert!(pinned(&format!(
            "create-next-app@{CREATE_NEXT_APP_VERSION}"
        )));
    }
}
