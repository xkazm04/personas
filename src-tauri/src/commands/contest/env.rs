//! The readiness probe behind the page's readiness strip. Every missing piece
//! is named by a stable problem CODE (the UI translates it), never prose.

use std::path::Path;

use super::node;
use super::types::{ContestEngineAvailability, ContestEnvironment};
use crate::db::DbPool;

pub const PROBLEM_NODE: &str = "node-missing";
pub const PROBLEM_INSTRUMENT: &str = "instrument-missing";
pub const PROBLEM_PLAYWRIGHT: &str = "playwright-missing";
pub const PROBLEM_CLAUDE: &str = "claude-missing";
pub const PROBLEM_CODEX: &str = "codex-missing";
pub const PROBLEM_GROK: &str = "grok-missing";

/// The claude CLI, through the resolver every Claude spawn uses.
fn claude_available() -> bool {
    #[cfg(windows)]
    {
        crate::engine::cli_process::resolve_claude_exe_windows().is_some()
    }
    #[cfg(not(windows))]
    {
        crate::commands::infrastructure::system::binary_probe::command_exists_in_path("claude")
    }
}

/// The problem codes of an environment, in a stable order.
pub fn problems_of(
    node_ok: bool,
    instrument: bool,
    engines: &ContestEngineAvailability,
    playwright: bool,
) -> Vec<String> {
    [
        (node_ok, PROBLEM_NODE),
        (instrument, PROBLEM_INSTRUMENT),
        (engines.claude, PROBLEM_CLAUDE),
        (engines.codex, PROBLEM_CODEX),
        (engines.grok, PROBLEM_GROK),
        (playwright, PROBLEM_PLAYWRIGHT),
    ]
    .into_iter()
    .filter(|(ok, _)| !ok)
    .map(|(_, code)| code.to_string())
    .collect()
}

pub async fn probe(db: &DbPool, project_root: &Path) -> ContestEnvironment {
    let node_ok = node::node_available().await;
    let instrument = node::resolve_instrument(db, project_root);
    let engines = tokio::task::spawn_blocking(|| ContestEngineAvailability {
        claude: claude_available(),
        codex: crate::commands::fleet::headless::resolve_codex_launch().is_ok(),
        grok: crate::engine::cli_process::resolve_grok_exe().is_some(),
    })
    .await
    .unwrap_or(ContestEngineAvailability {
        claude: false,
        codex: false,
        grok: false,
    });
    let playwright = node::playwright_available(project_root);
    let problems = problems_of(node_ok, instrument.is_some(), &engines, playwright);
    ContestEnvironment {
        node: node_ok,
        instrument_path: instrument.map(|p| p.to_string_lossy().into_owned()),
        engines,
        playwright,
        problems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn problems_are_stable_codes_in_order() {
        let all_ok = ContestEngineAvailability {
            claude: true,
            codex: true,
            grok: true,
        };
        assert!(problems_of(true, true, &all_ok, true).is_empty());
        let none = ContestEngineAvailability {
            claude: false,
            codex: false,
            grok: false,
        };
        assert_eq!(
            problems_of(false, false, &none, false),
            vec![
                "node-missing",
                "instrument-missing",
                "claude-missing",
                "codex-missing",
                "grok-missing",
                "playwright-missing"
            ]
        );
    }
}
