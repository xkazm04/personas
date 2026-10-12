//! LIVE round-trip probe for persona HTML reports (spends real subscription
//! tokens; never in the normal run).
//!
//! Every other test of the `content_type: "html"` contract scripts the model.
//! This one proves the model's actual output gets through every door a real
//! persona run uses, in the runner's own order:
//!
//! 1. the real prompt builder (`prompt::assemble_prompt`), which carries the
//!    User Message Protocol's HTML paragraph;
//! 2. the real CLI args (`provider.build_execution_args`) and the real spawn
//!    (`CliProcessDriver::spawn`), prompt on stdin as the runner delivers it;
//! 3. the runner's own line reader (`read_line_limited`, the 64 KB cap) and
//!    stream parser (`provider.parse_stream_line`), protocol lines found the
//!    way the runner finds them — per assistant-text line, and on the virtual
//!    protocol-tool door;
//! 4. the real `dispatch`, into a real (temp) database.
//!
//! It then asserts the stored report row is `content_type = "html"` and that
//! the document still has visible content once everything the renderer's
//! sanitizer removes (scripts, `<style>`, `<head>`, tags) is gone. The
//! renderer's sanitizer itself is TypeScript; set `PERSONAS_HTML_PROBE_OUT` to
//! a file path to keep the stored document for an out-of-band
//! `sanitizeHtmlDocument` check.
//!
//! The CLI runs in an EMPTY directory: the prompt carries its own context, and
//! a repo cwd would load the repo's CLAUDE.md, rules and hooks into the run
//! (the twin-setup measurement: 4.4x the cost for nothing).
//!
//! ```text
//! npm run test:rust -- live_persona_html_report_round_trip -- --ignored --nocapture
//! ```

use super::*;
use crate::engine::cli_process::{read_line_limited, CliProcessDriver};
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::provider::{resolve_provider, EngineKind, PromptDelivery};
use crate::error::AppError;
use personas_core::model_ids::SONNET_CURRENT;
use personas_core::types::{ModelProfile, StreamLineType};

/// The whole run may take this long before the probe gives up.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

struct NullEmitter;

impl ExecutionEventEmitter for NullEmitter {
    fn emit_json(&self, _event: &str, _payload: serde_json::Value) {}
}

/// Visible text left once the parts the renderer drops are gone: `<head>`
/// (title, `<style>`), `<script>`, `<style>`, then every tag. A crude
/// stand-in for `sanitizeHtmlDocument` — it can only under-count, never invent
/// text — so "non-empty here" implies "non-empty after the real sanitizer".
fn visible_text(html: &str) -> String {
    fn drop_blocks(mut s: String, tag: &str) -> String {
        loop {
            let lower = s.to_ascii_lowercase();
            let Some(start) = lower.find(&format!("<{tag}")) else {
                return s;
            };
            let close = format!("</{tag}>");
            let end = lower[start..]
                .find(&close)
                .map(|i| start + i + close.len())
                .unwrap_or(s.len());
            s.replace_range(start..end, " ");
        }
    }
    let mut s = html.to_string();
    for tag in ["head", "script", "style"] {
        s = drop_blocks(s, tag);
    }
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn visible_text_strips_what_the_renderer_drops() {
    let doc = "<html><head><title>T</title><style>p{color:red}</style></head>\
               <body><script>alert(1)</script><h1>Score</h1><p>Alpha <b>wins</b></p></body></html>";
    assert_eq!(visible_text(doc), "Score Alpha wins");
    assert_eq!(visible_text("<style>x</style><script>y</script>"), "");
}

#[tokio::test]
#[ignore = "live: spawns the real Claude CLI and spends subscription tokens"]
async fn live_persona_html_report_round_trip() -> Result<(), AppError> {
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas as persona_repo;

    let pool = crate::db::init_test_db()?;
    let created = persona_repo::create(
        &pool,
        CreatePersonaInput {
            name: "Release Scorecard".into(),
            system_prompt: "You are Release Scorecard. Each run you compare the release \
                candidates in your input data on speed, stability and cost, pick a winner, and \
                deliver ONE small one-screen scorecard to the user as an HTML report \
                (content_type \"html\") with a descriptive title. You have no tools to call \
                and nothing to look up: everything you need is in the input data."
                .into(),
            project_id: None,
            description: None,
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            notification_channels: None,
            lifecycle: None,
        },
    )?;
    let persona = persona_repo::get_by_id(&pool, &created.id)?;
    let input = serde_json::json!({
        "candidates": [
            {"name": "Alpha", "p95_ms": 210, "crash_rate_pct": 0.4, "cost_per_1k_usd": 0.82},
            {"name": "Beta",  "p95_ms": 180, "crash_rate_pct": 1.1, "cost_per_1k_usd": 0.64},
            {"name": "Gamma", "p95_ms": 260, "crash_rate_pct": 0.2, "cost_per_1k_usd": 0.91}
        ]
    });

    // 1. The real prompt builder.
    let prompt_text = prompt::assemble_prompt(
        &persona,
        &[],
        Some(&input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt_text.contains("**HTML document**"),
        "the prompt under test must carry the HTML guidance"
    );

    // 2. The real args and spawn, in an empty directory.
    let provider = resolve_provider(EngineKind::ClaudeCode);
    let profile = ModelProfile {
        model: Some(SONNET_CURRENT.to_string()),
        effort: Some("low".to_string()),
        ..Default::default()
    };
    let cli_args = provider.build_execution_args(Some(&persona), Some(&profile));
    let cwd = std::env::temp_dir().join("personas-html-report-probe");
    std::fs::create_dir_all(&cwd)?;
    let mut driver = CliProcessDriver::spawn(&cli_args, cwd)?;
    match provider.prompt_delivery() {
        PromptDelivery::Stdin => driver.write_stdin(prompt_text.as_bytes()).await,
        PromptDelivery::PositionalArg | PromptDelivery::Flag(_) => driver.close_stdin().await,
    }
    let mut reader = driver
        .take_stdout_reader()
        .ok_or_else(|| AppError::Internal("probe: no stdout pipe".into()))?;

    // 3 + 4. The runner's reader and parser, into the real dispatcher.
    let exec_id = format!("exec-{}", uuid::Uuid::new_v4());
    let log_dir = std::env::temp_dir().join(format!("personas_html_probe_{exec_id}"));
    let mut logger = ExecutionLogger::new(&log_dir, &exec_id)?;
    let emitter = NullEmitter;
    let mut protocol_lines = 0usize;
    let mut cost_usd: Option<f64> = None;
    let started = std::time::Instant::now();
    loop {
        let remaining = PROBE_TIMEOUT.saturating_sub(started.elapsed());
        let line = match tokio::time::timeout(remaining, read_line_limited(&mut reader)).await {
            Err(_) => {
                driver.kill().await;
                return Err(AppError::Internal(
                    "probe: CLI did not finish in time".into(),
                ));
            }
            Ok(read) => match read? {
                Some(line) => line,
                None => break,
            },
        };
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                cost_usd = v.get("total_cost_usd").and_then(|c| c.as_f64());
            }
        }
        let (line_type, _) = provider.parse_stream_line(&line);
        let mut found: Vec<ProtocolMessage> = Vec::new();
        match line_type {
            StreamLineType::AssistantText { ref text } => {
                for text_line in text.split('\n') {
                    let trimmed = text_line.trim();
                    if trimmed.starts_with('{') {
                        if let Some(msg) = serde_json::from_str::<serde_json::Value>(trimmed)
                            .ok()
                            .and_then(|v| parser::extract_protocol_message_from_value(&v))
                        {
                            found.push(msg);
                        }
                    }
                }
            }
            StreamLineType::AssistantToolUse {
                protocol: Some(ref msg),
                ..
            } => found.push(msg.clone()),
            _ => {}
        }
        for msg in found {
            protocol_lines += 1;
            let mut ctx = DispatchContext::new(
                &emitter,
                &pool,
                &exec_id,
                &persona.id,
                "proj-probe",
                &persona.name,
                None,
                &mut logger,
                Some(QualityGateConfig::default()),
            );
            ctx.is_simulation = true; // no notification fan-out from a probe
            dispatch(&mut ctx, &msg);
        }
    }
    let status = driver.finish().await?;
    drop(logger);
    let _ = std::fs::remove_dir_all(&log_dir);

    let rows: Vec<(Option<String>, String, String)> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT title, content_type, content FROM persona_reports WHERE persona_id = ?1",
        )?;
        let mapped = stmt.query_map(rusqlite::params![persona.id], |r| {
            Ok((r.get("title")?, r.get("content_type")?, r.get("content")?))
        })?;
        mapped.collect::<Result<_, _>>()?
    };
    eprintln!(
        "[live] exit {status}, {} ms, prompt {} chars, {protocol_lines} protocol messages, \
         {} report rows, cost {}",
        started.elapsed().as_millis(),
        prompt_text.chars().count(),
        rows.len(),
        cost_usd.map_or("n/a".to_string(), |c| format!("${c:.4}")),
    );
    for (title, ct, content) in &rows {
        eprintln!(
            "[live] report {:?} content_type={ct} {} bytes, visible text {} chars",
            title,
            content.len(),
            visible_text(content).chars().count()
        );
    }

    let (_, _, html) = rows
        .iter()
        .find(|(_, ct, _)| ct == HTML_CONTENT_TYPE)
        .ok_or_else(|| {
            AppError::Internal(format!(
                "probe: no html report row; content types stored: {:?}",
                rows.iter().map(|r| r.1.as_str()).collect::<Vec<_>>()
            ))
        })?;
    if let Ok(out) = std::env::var("PERSONAS_HTML_PROBE_OUT") {
        std::fs::write(&out, html)?;
        eprintln!("[live] stored document written to {out}");
    }
    assert!(
        !visible_text(html).is_empty(),
        "the stored HTML has no visible content once sanitized"
    );
    Ok(())
}
