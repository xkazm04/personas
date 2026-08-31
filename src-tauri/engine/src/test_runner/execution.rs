use std::sync::Arc;

use crate::cli_process::CliProcessDriver;

use personas_db::models::{CreateLabResultEventInput, Persona, PersonaToolDefinition};
use personas_db::DbPool;

use super::{ExecutionOutput, MockToolResponse, TestModelConfig, TestScenario};
use crate::parser;
use crate::prompt;
use personas_core::types::*;

/// Resolve when the shared cancellation flag flips to `true`, polling on a short
/// interval. Used to race a running cell's CLI execution against cancellation so
/// the in-flight child is dropped (and, via `kill_on_drop`, killed) within a
/// second or two of cancel rather than blocking on the per-cell CLI timeout.
pub(crate) async fn await_cancel(flag: &Arc<std::sync::atomic::AtomicBool>) {
    while !flag.load(std::sync::atomic::Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Truncate `s` to at most `max_chars` characters without splitting a multibyte
/// UTF-8 character. Byte-range slicing (`&s[..n]`) panics when `n` lands
/// mid-glyph, which LLM output (emoji, smart quotes, em-dashes, CJK) routinely
/// produces — so previews here must count characters, not bytes.
pub(crate) fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

pub async fn execute_scenario(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    scenario: &TestScenario,
    model: &TestModelConfig,
) -> Result<ExecutionOutput, String> {
    // Build the base prompt.
    //
    // Living-agent sections: `assemble_prompt` passes None for both
    // responsibilities and recent episodes ON PURPOSE — the Lab isolates
    // prompt variables, so a version-vs-version or model-vs-model cell must
    // measure ONLY the prompt under test, not whatever charters/episodes the
    // live persona happens to carry at run time. (`## Core` still renders:
    // it travels on the persona snapshot the Lab explicitly constructs.)
    let base_prompt = prompt::assemble_prompt(
        persona,
        tools,
        scenario.input_data.as_ref(),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    // Inject sandbox mock section before the EXECUTE NOW section
    let sandbox_section = build_sandbox_section(&scenario.mock_tools);
    let final_prompt = inject_sandbox_into_prompt(&base_prompt, &sandbox_section);

    // Build CLI args for this model
    let model_profile = ModelProfile {
        model: model.model.clone(),
        provider: Some(model.provider.clone()),
        base_url: model.base_url.clone(),
        auth_token: model.auth_token.clone(),
        prompt_cache_policy: None,
        // Lab can vary --effort across cells alongside model. Falls back to
        // prompt::DEFAULT_EFFORT when None.
        effort: model.effort.clone(),
    };

    // Native Ollama path: call HTTP API directly instead of spawning Claude CLI
    if model.provider == personas_core::types::providers::OLLAMA {
        return execute_scenario_ollama(&final_prompt, &model_profile).await;
    }

    let mut cli_args = prompt::build_cli_args(None, Some(&model_profile));

    // Limit turns for sandbox testing
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("3".to_string());

    // Run the CLI and collect structured output
    spawn_cli_and_collect_structured(&cli_args, &final_prompt).await
}

/// Execute a test scenario using native Ollama HTTP API.
/// Bypasses CLI — calls `/api/chat` directly and returns structured output.
async fn execute_scenario_ollama(
    prompt: &str,
    profile: &ModelProfile,
) -> Result<ExecutionOutput, String> {
    let base_url = profile
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let model = profile.model.as_deref().unwrap_or("gemma4");
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let start = std::time::Instant::now();

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "stream": false
    });

    let client = personas_core::http_clients::SHARED_HTTP.clone();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama API error ({}): {}",
            status,
            truncate_chars(&text, 200)
        ));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Ollama JSON parse failed: {e}"))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let assistant_text = json
        .pointer("/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let eval_count = json.get("eval_count").and_then(|v| v.as_u64()).unwrap_or(0);
    let prompt_eval_count = json
        .get("prompt_eval_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let events = if assistant_text.is_empty() {
        Vec::new()
    } else {
        vec![CreateLabResultEventInput {
            event_index: 0,
            event_type: "assistant_text".to_string(),
            tool_name: None,
            tool_args_preview: None,
            tool_result_preview: None,
            text_preview: Some(assistant_text.clone()),
            ts_ms_relative: duration_ms as i64,
        }]
    };

    Ok(ExecutionOutput {
        assistant_text,
        tool_calls: Vec::new(), // local models don't use tool protocol
        input_tokens: prompt_eval_count,
        output_tokens: eval_count,
        cost_usd: 0.0,
        duration_ms,
        error: None,
        events,
    })
}

fn build_sandbox_section(mock_tools: &[MockToolResponse]) -> String {
    let mut section = String::new();
    section.push_str("\n## SANDBOX TESTING MODE -- Simulated Tool Environment\n");
    section.push_str("You are running in test mode. Do NOT call actual tools.\n");
    section
        .push_str("Instead, use these simulated tool responses as if the tools returned them:\n\n");

    for mock in mock_tools {
        section.push_str(&format!(
            "### Simulated response for `{}`\n",
            mock.tool_name
        ));
        if let Some(ref desc) = mock.description {
            section.push_str(&format!("Context: {desc}\n"));
        }
        section.push_str("Assume it returns:\n```json\n");
        section.push_str(&serde_json::to_string_pretty(&mock.mock_response).unwrap_or_default());
        section.push_str("\n```\n\n");
    }

    section.push_str("Process these simulated results exactly as you would real tool responses.\n");
    section.push_str("Complete your full workflow and emit all appropriate protocol messages.\n");
    section.push_str("Do NOT mention that you are in test mode.\n\n");

    section
}

fn inject_sandbox_into_prompt(base_prompt: &str, sandbox_section: &str) -> String {
    // Insert the sandbox section before "## EXECUTE NOW" if it exists
    if let Some(pos) = base_prompt.find("## EXECUTE NOW") {
        let mut result = String::with_capacity(base_prompt.len() + sandbox_section.len());
        result.push_str(&base_prompt[..pos]);
        result.push_str(sandbox_section);
        result.push_str(&base_prompt[pos..]);
        result
    } else {
        // Fallback: append at end
        format!("{base_prompt}\n{sandbox_section}")
    }
}

/// Build a configured CLI `Command` with a temporary working directory.
///
/// Creates the temp dir, configures args, piped stdin/stdout, null stderr,
/// Windows `CREATE_NO_WINDOW` flag, and env overrides/removals.
/// Spawn Claude CLI, pipe prompt to stdin, collect all output as a plain string.
/// Used for the coordinator (scenario generation).
pub(crate) async fn spawn_cli_and_collect(
    cli_args: &CliArgs,
    prompt_text: &str,
    pool: &DbPool,
    spend: personas_db::repos::llm_spend::SpendCtx<'_>,
) -> Result<String, String> {
    let mut driver = CliProcessDriver::spawn_temp_no_stderr(cli_args, "personas-test-coord")?;
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let mut result_line: Option<String> = None;
    let timeout = tokio::time::Duration::from_secs(300);

    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            match line_type {
                StreamLineType::AssistantText { text } => {
                    assistant_text.push_str(&text);
                    assistant_text.push('\n');
                }
                StreamLineType::Result { .. } => {
                    result_line = Some(line.to_string());
                }
                _ => {}
            }
        })
        .await?;

    let _ = driver.finish().await;

    // tiger #1: record headless spend in the dev_llm_spend ledger (best-effort).
    if let Some(rl) = &result_line {
        personas_db::repos::llm_spend::observe_line(pool, &spend, rl);
    }

    Ok(assistant_text)
}

/// Spawn Claude CLI, pipe prompt to stdin, collect structured execution output.
/// Used for the per-model persona execution.
async fn spawn_cli_and_collect_structured(
    cli_args: &CliArgs,
    prompt_text: &str,
) -> Result<ExecutionOutput, String> {
    let mut driver = CliProcessDriver::spawn_temp_no_stderr(cli_args, "personas-test-exec")?;
    let start = std::time::Instant::now();
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let mut tool_calls: Vec<String> = Vec::new();
    let mut metrics = ExecutionMetrics::default();
    // Captured stream-event log for the lab event-stream sidecar.
    let mut events: Vec<CreateLabResultEventInput> = Vec::new();

    let timeout = tokio::time::Duration::from_secs(300);
    let stream_err = driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            let ts_ms = start.elapsed().as_millis() as i64;
            let idx = events.len() as i32;

            match line_type {
                StreamLineType::AssistantText { text } => {
                    assistant_text.push_str(&text);
                    assistant_text.push('\n');
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "assistant_text".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(text),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::AssistantToolUse {
                    tool_name,
                    input_preview,
                } => {
                    tool_calls.push(tool_name.clone());
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_use".to_string(),
                        tool_name: Some(tool_name),
                        tool_args_preview: Some(input_preview),
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::AssistantTodoWrite { items } => {
                    tool_calls.push("TodoWrite".to_string());
                    let preview = serde_json::to_string(&items).unwrap_or_default();
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_use".to_string(),
                        tool_name: Some("TodoWrite".to_string()),
                        tool_args_preview: Some(preview),
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::ToolResult { content_preview } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_result".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: Some(content_preview),
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::SystemInit { ref model, .. } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "system_init".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(model.clone()),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::Result { .. } => {
                    parser::update_metrics_from_result(&mut metrics, &line_type);
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "result".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::TaskStarted {
                    description,
                    subagent_type,
                    ..
                } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_started".to_string(),
                        tool_name: Some(subagent_type),
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(description),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::TaskNotification { status, .. } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_update".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: Some(status),
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::SubagentMessage {
                    text, tool_name, ..
                } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_message".to_string(),
                        tool_name,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: (!text.is_empty()).then_some(text),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::Unknown => {}
            }
        })
        .await;

    // On a collect-timeout the child is presumed hung (that's why the stream
    // never produced a `Result` line within the window) -- kill it instead of
    // awaiting a natural exit that may never come, which would otherwise wedge
    // this task (and the lab run's progress) with no upper time bound.
    let exit = if stream_err.is_err() {
        driver.kill().await;
        Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "collect_lines_with_timeout timed out",
        ))
    } else {
        driver.wait().await
    };
    let duration_ms = start.elapsed().as_millis() as u64;
    driver.cleanup_dir();

    let error = if stream_err.is_err() {
        Some("Execution timed out after 300 seconds".to_string())
    } else if let Ok(status) = exit {
        if !status.success() {
            Some(format!(
                "CLI exited with code {}",
                status.code().unwrap_or(-1)
            ))
        } else {
            None
        }
    } else {
        None
    };

    Ok(ExecutionOutput {
        assistant_text,
        tool_calls,
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cost_usd: metrics.cost_usd,
        duration_ms,
        error,
        events,
    })
}
