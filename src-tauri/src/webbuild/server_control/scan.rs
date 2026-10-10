//! The one-shot repository scan behind Add app and Rescan.
//!
//! A headless Claude CLI turn in `cwd = root_path` reads the repository and
//! answers with one JSON object: the dev command, the port the project pins
//! (if any) and its tech stack. It runs through the subprocess chokepoint's
//! headless door (`cli_process::spawn_headless_claude_route`), the one that takes a
//! working directory and owns the guarantees this needs: `kill_on_drop`, no
//! window, and `force_subscription_auth`, so the scan bills the operator's
//! subscription and never the API. `companion::brain::oneshot` was the other
//! candidate; it always runs in the home directory, and the scan's whole input
//! is the repository it stands in.
//!
//! The turn may READ the repository and nothing else: `Bash`, `Edit`, `Write`
//! and the web tools are denied, because a cloned repository is input the
//! operator did not write, and a scan is not a reason to run any of it.
//!
//! The reply is untrusted: the command it proposes is validated by the same
//! [`super::validate_command`] as the operator's own, before anything is
//! written.

use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::companion::brain::oneshot::{extract_assistant_text, extract_json_span, preview};
use crate::db::DbPool;
use crate::error::AppError;

/// The scan's ceiling (contract: 120 s).
pub const SCAN_TIMEOUT: Duration = Duration::from_secs(120);

/// The call class the scan runs as: read a repository into a fixed JSON
/// shape. Model and effort come from the class table
/// (`personas_core::model_class`); a reply [`parse_finding`] rejects
/// escalates once. (The original contract pinned Sonnet; the 2026-10-08
/// one-shot bench moved extraction to the class table.)
const SCAN_CLASS: personas_core::model_class::CallClass =
    personas_core::model_class::CallClass::Extract;

/// Tools the scan turn may not use: it reads, it never runs or writes.
const SCAN_DENIED_TOOLS: &str = "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch";

/// At most this many tech-stack names are kept (contract: 2 to 6).
const MAX_TECH_NAMES: usize = 6;

/// How much of an unparsable reply an error quotes.
const REPLY_PREVIEW_BYTES: usize = 200;

const SCAN_PROMPT: &str = r#"You are looking at a software repository (the current working directory) to learn how to run its local development server. Read package.json, the lockfile that is present (bun.lock or bun.lockb means bun, pnpm-lock.yaml means pnpm, yarn.lock means yarn, package-lock.json means npm) and the framework config (vite.config.*, next.config.*, astro.config.*, nuxt.config.*, svelte.config.* and similar). Do not run anything and do not change any file.

Answer with exactly one JSON object and nothing else, no prose and no code fence:
{"devCommand": string, "port": number | null, "techStack": string[]}

Rules:
- devCommand is the dev script invocation for this repository's package manager, and it must make the server listen on the port written as the placeholder {port}. Example: "npm run dev -- --port {port}" for Vite, or "npm run dev" for Next.js, which reads the PORT environment variable. The server is always started with PORT=<port> in its environment.
- devCommand is ONE command: it must not contain & | ; < > ` $ % ( ) or a line break, and {port} is the only placeholder.
- port is the port the project's own config pins for its dev server, or null when it pins none.
- techStack holds 2 to 6 display names: framework, language, styling, runtime. Example: ["Next.js", "React", "TypeScript", "Tailwind CSS"]."#;

/// What a scan found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanFinding {
    pub dev_command: String,
    pub port: Option<u16>,
    pub tech_stack: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanWire {
    dev_command: String,
    #[serde(default)]
    port: Option<serde_json::Value>,
    #[serde(default)]
    tech_stack: Vec<String>,
}

/// Parse the scan's reply. A reply that is not the contract's JSON is an
/// error that quotes the head of what came back.
pub fn parse_finding(reply: &str) -> Result<ScanFinding, AppError> {
    let span = extract_json_span(reply, "dev server scan reply")?;
    let wire: ScanWire = serde_json::from_str(span).map_err(|e| {
        AppError::Validation(format!(
            "the scan reply is not the expected JSON ({e}): {}",
            preview(span, REPLY_PREVIEW_BYTES)
        ))
    })?;
    // A number, or a number written as a string; anything else (or out of
    // range) is "no pinned port", never a guess.
    let port = match wire.port {
        Some(serde_json::Value::Number(n)) => n.as_u64(),
        Some(serde_json::Value::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
    .and_then(|p| u16::try_from(p).ok())
    .filter(|p| *p != 0);
    let mut seen = std::collections::HashSet::new();
    let tech_stack = wire
        .tech_stack
        .iter()
        // The column is comma-joined, so a comma inside a name would split it.
        .map(|t| {
            t.replace(',', " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|t| !t.is_empty() && seen.insert(t.to_lowercase()))
        .take(MAX_TECH_NAMES)
        .collect();
    Ok(ScanFinding {
        dev_command: wire.dev_command.trim().to_string(),
        port,
        tech_stack,
    })
}

/// A stream-json `result` event's text and whether the CLI flagged it as an
/// error. `None` for every other line.
fn result_event(line: &str) -> Option<(String, bool)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "result" {
        return None;
    }
    let text = v
        .get("result")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let is_error = v
        .get("is_error")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    Some((text, is_error))
}

/// Run the scan turn in `root` and parse its answer. `Err` carries the reason
/// the caller records as `scan failed: <reason>`.
pub async fn run(pool: &DbPool, project_id: &str, root: &Path) -> Result<ScanFinding, String> {
    crate::engine::cli_process::with_escalation(SCAN_CLASS, |route| {
        run_attempt(pool, project_id, root, route)
    })
    .await
    .map_err(|e| match e {
        // An attempt's own reason, verbatim.
        AppError::Internal(reason) => reason,
        other => other.to_string(),
    })
}

/// One scan turn on `route`. A reply [`parse_finding`] rejects is
/// `BadOutput` (the only outcome that escalates); everything else is `Fatal`.
async fn run_attempt(
    pool: &DbPool,
    project_id: &str,
    root: &Path,
    route: personas_core::model_class::ClassRoute,
) -> Result<ScanFinding, crate::engine::cli_process::AttemptError> {
    use crate::engine::cli_process::AttemptError;
    let fatal = |reason: String| AttemptError::Fatal(AppError::Internal(reason));

    let extra = vec![
        "--disallowedTools".to_string(),
        SCAN_DENIED_TOOLS.to_string(),
    ];
    let mut child = crate::engine::cli_process::spawn_headless_claude_route(
        SCAN_PROMPT.to_string(),
        route,
        &extra,
        Some(root),
        false,
    )
    .map_err(|e| fatal(e.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| fatal("the scan turn produced no output pipe".to_string()))?;
    let mut lines = BufReader::new(stdout).lines();

    let spend = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: if crate::engine::cli_process::is_escalation_leg(SCAN_CLASS, route) {
            "escalation"
        } else {
            "dev_server_scan"
        },
        model: Some(route.model),
        persona_id: None,
        project_id: Some(project_id),
    };
    let mut streamed = String::new();
    let mut result: Option<(String, bool)> = None;
    let read = tokio::time::timeout(SCAN_TIMEOUT, async {
        while let Ok(Some(line)) = lines.next_line().await {
            // Record the turn's cost on its `result` line (no-op otherwise).
            crate::db::repos::llm_spend::observe_line(pool, &spend, &line);
            if let Some(event) = result_event(&line) {
                result = Some(event);
            } else if let Some(text) = extract_assistant_text(&line) {
                streamed.push_str(&text);
                streamed.push('\n');
            }
        }
    })
    .await;
    // Deterministic reap: the turn is over (or out of time) either way.
    if let Err(e) = child.kill().await {
        tracing::debug!(error = %e, "dev server scan: the CLI had already exited");
    }

    if read.is_err() {
        return Err(fatal(format!(
            "no answer within {} s",
            SCAN_TIMEOUT.as_secs()
        )));
    }
    let reply = match result {
        Some((text, true)) => {
            return Err(fatal(format!(
                "the CLI reported an error: {}",
                preview(&text, REPLY_PREVIEW_BYTES)
            )))
        }
        Some((text, false)) if !text.trim().is_empty() => text,
        _ => streamed,
    };
    if reply.trim().is_empty() {
        return Err(fatal("the scan turn answered with nothing".to_string()));
    }
    parse_finding(&reply).map_err(|e| AttemptError::BadOutput(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_reply_parses() {
        let f = parse_finding(
            r#"{"devCommand":"npm run dev -- --port {port}","port":5173,"techStack":["Vite","React","TypeScript"]}"#,
        )
        .unwrap();
        assert_eq!(f.dev_command, "npm run dev -- --port {port}");
        assert_eq!(f.port, Some(5173));
        assert_eq!(f.tech_stack, vec!["Vite", "React", "TypeScript"]);
    }

    #[test]
    fn a_fenced_reply_with_prose_parses() {
        let reply = "Here you go:\n```json\n{\"devCommand\": \"npm run dev\", \"port\": null, \"techStack\": [\"Next.js\", \"React\"]}\n```";
        let f = parse_finding(reply).unwrap();
        assert_eq!(f.dev_command, "npm run dev");
        assert_eq!(f.port, None);
        assert_eq!(f.tech_stack, vec!["Next.js", "React"]);
    }

    #[test]
    fn a_port_is_a_number_or_nothing() {
        let p = |port: &str| {
            parse_finding(&format!(
                r#"{{"devCommand":"npm run dev","port":{port},"techStack":[]}}"#
            ))
            .unwrap()
            .port
        };
        assert_eq!(p("3000"), Some(3000));
        assert_eq!(p("\"4321\""), Some(4321));
        assert_eq!(p("0"), None);
        assert_eq!(p("70000"), None);
        assert_eq!(p("-1"), None);
        assert_eq!(p("\"auto\""), None);
        assert_eq!(p("null"), None);
    }

    #[test]
    fn the_tech_stack_is_cleaned_deduplicated_and_capped() {
        let f = parse_finding(
            r#"{"devCommand":"bun run dev","techStack":[" Next.js ","react","React","","Tailwind, CSS","TypeScript","Bun","Zustand","Vitest"]}"#,
        )
        .unwrap();
        assert_eq!(
            f.tech_stack,
            vec![
                "Next.js",
                "react",
                "Tailwind CSS",
                "TypeScript",
                "Bun",
                "Zustand"
            ]
        );
        assert_eq!(f.port, None);
    }

    #[test]
    fn a_reply_that_is_not_the_json_says_why() {
        let e = parse_finding("I could not find a dev script.").unwrap_err();
        assert!(e.to_string().contains("missing JSON object"), "{e}");
        let e = parse_finding(r#"{"port": 3000}"#).unwrap_err();
        assert!(e.to_string().contains("devCommand"), "{e}");
    }

    #[test]
    fn the_prompt_states_the_contract_shape() {
        assert!(SCAN_PROMPT
            .contains(r#"{"devCommand": string, "port": number | null, "techStack": string[]}"#));
        assert!(SCAN_PROMPT.contains("{port}"));
    }
}
