//! Build CLI invocation argv + env for the Claude Code subprocess.

use crate::db::models::Persona;

use super::super::types::{CliArgs, ModelProfile};

/// Platform-specific command and initial args for invoking the Claude CLI.
pub(super) fn base_cli_setup() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "claude.cmd".to_string()],
        )
    } else {
        ("claude".to_string(), vec![])
    }
}

/// Apply provider-specific environment overrides and removals to a CliArgs.
/// Reused by build_cli_args and test_runner.
///
/// Note: Ollama, LiteLLM, and Custom provider paths were removed — Claude Code
/// CLI only supports Anthropic models. See harness-learnings Run #4 for details.
pub fn apply_provider_env(cli_args: &mut CliArgs, profile: &ModelProfile) {
    match profile.provider.as_deref() {
        _ => {
            // Default provider (anthropic) -- no special env needed.
            // Claude Code CLI validates model names against Anthropic's list
            // and does not support OLLAMA_BASE_URL, OPENAI_BASE_URL, etc.
            let _ = (cli_args, profile);
        }
    }
}

/// Default Claude CLI effort level passed by `build_cli_args` when neither
/// the persona nor the model profile specifies one.
///
/// CLI 2.1.94 silently changed the implicit default from `medium` to `high`
/// for API-key, Bedrock, Vertex, Foundry, Team, and Enterprise users —
/// silently increasing cost and latency for personas executions on those
/// tiers. We pin "medium" everywhere so behavior stays deterministic across
/// CLI versions and account tiers; callers (lab, persona settings) can
/// override per-execution via `ModelProfile.effort`.
pub const DEFAULT_EFFORT: &str = "medium";

/// Resolve the effort level for a given model profile, falling back to
/// `DEFAULT_EFFORT` when unset or empty.
pub(super) fn resolve_effort(model_profile: Option<&ModelProfile>) -> String {
    model_profile
        .and_then(|p| p.effort.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_EFFORT)
        .to_string()
}

/// Build CLI arguments for spawning the Claude CLI process.
///
/// When called without a persona or model profile (both `None`), produces the
/// same result as the former `build_default_cli_args()`.
///
/// This signature is preserved for the 30+ existing call sites. For new
/// call sites that want to inject a W3C `TRACEPARENT` header into the child
/// CLI's env (so personas' trace and the CLI's internal spans can be
/// correlated), use [`build_cli_args_with_trace`] instead.
pub fn build_cli_args(
    persona: Option<&Persona>,
    model_profile: Option<&ModelProfile>,
) -> CliArgs {
    build_cli_args_with_trace(persona, model_profile, None)
}

/// Like [`build_cli_args`], but also injects the W3C `TRACEPARENT` (and
/// optional `TRACESTATE`) env var on the resulting `CliArgs` so the spawned
/// Claude CLI 2.1.110+ participates in the same distributed trace as personas'
/// own span tree. Returns unchanged args when `trace` is `None`.
pub fn build_cli_args_with_trace(
    persona: Option<&Persona>,
    model_profile: Option<&ModelProfile>,
    trace: Option<&super::super::trace::W3cTraceContext>,
) -> CliArgs {
    let mut cli_args = build_cli_args_inner(persona, model_profile);
    if let Some(t) = trace {
        cli_args
            .env_overrides
            .push(("TRACEPARENT".to_string(), t.traceparent_header()));
        if let Some(state) = t.tracestate_header() {
            cli_args.env_overrides.push(("TRACESTATE".to_string(), state));
        }
    }
    cli_args
}

/// Internal implementation — body of the former `build_cli_args`. Extracted
/// so [`build_cli_args`] and [`build_cli_args_with_trace`] share the same core
/// without either recursing through the other.
pub(super) fn build_cli_args_inner(
    persona: Option<&Persona>,
    model_profile: Option<&ModelProfile>,
) -> CliArgs {
    let (command, mut args) = base_cli_setup();

    // Base flags: read prompt from stdin, stream-json output, verbose (required by
    // --print + stream-json), skip permissions.
    // NOTE: --verbose causes Claude CLI to emit both JSON events AND plain-text lines.
    // The parser filters out non-JSON lines to prevent duplicate output display.
    args.extend([
        "-p".to_string(),
        "-".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
        // Strip CLI's own dynamic system-prompt sections (git status, cwd, etc.)
        // that are irrelevant to persona executions. Enables cross-user prompt
        // caching on the API side for lower cost. Requires CLI ≥ 2.1.98.
        "--exclude-dynamic-system-prompt-sections".to_string(),
    ]);

    // Effort level — explicit so personas behavior is deterministic across
    // CLI versions and account tiers (see DEFAULT_EFFORT docstring).
    args.push("--effort".to_string());
    args.push(resolve_effort(model_profile));

    // Model override
    if let Some(profile) = model_profile {
        if let Some(ref model) = profile.model {
            if !model.is_empty() {
                args.push("--model".to_string());
                args.push(model.clone());
            }
        }
    }

    // Persona-specific flags
    if let Some(persona) = persona {
        // Budget limit
        if let Some(budget) = persona.max_budget_usd {
            if budget > 0.0 {
                args.push("--max-budget-usd".to_string());
                args.push(format!("{budget}"));
            }
        }

        // Max turns
        if let Some(turns) = persona.max_turns {
            if turns > 0 {
                args.push("--max-turns".to_string());
                args.push(format!("{turns}"));
            }
        }
    }

    let mut cli_args = CliArgs {
        command,
        args,
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: None,
    };

    // Provider env
    if let Some(profile) = model_profile {
        apply_provider_env(&mut cli_args, profile);

        // Prompt cache policy: pass as env var for the execution runtime
        if let Some(ref policy) = profile.prompt_cache_policy {
            if policy != "none" && !policy.is_empty() {
                cli_args
                    .env_overrides
                    .push(("PROMPT_CACHE_POLICY".to_string(), policy.clone()));
            }
        }
    }

    cli_args.env_removals.push("CLAUDECODE".to_string());
    cli_args.env_removals.push("CLAUDE_CODE".to_string());
    // Strip DISABLE_PROMPT_CACHING* inherited from the parent shell so personas
    // executions always get prompt caching regardless of user env state. CLI
    // 2.1.108 started warning at startup when these are set; the warning lands
    // on stderr and can confuse log consumers. Keep enumerated — env_remove is
    // exact-match, not prefix.
    cli_args.env_removals.push("DISABLE_PROMPT_CACHING".to_string());
    cli_args.env_removals.push("DISABLE_PROMPT_CACHING_1H".to_string());
    cli_args.env_removals.push("DISABLE_PROMPT_CACHING_5M".to_string());

    // Suppress the CLI's nonessential traffic — no value in headless mode:
    // - Auto-title: the CLI otherwise makes an extra Haiku call to name the
    //   session; personas uses its own session naming.
    // - Terminal title: the CLI emits terminal escape codes that we do not
    //   surface; setting the suppression env removes the extra work.
    // Both are env-gated. Introduced in CLI 2.1.111.
    cli_args.env_overrides.push((
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
        "1".to_string(),
    ));
    cli_args.env_overrides.push((
        "CLAUDE_CODE_DISABLE_TERMINAL_TITLE".to_string(),
        "1".to_string(),
    ));
    // Block every CLI auto-update path during headless spawns. Personas runs
    // `claude -p` dozens of times per session; a mid-spawn updater adds startup
    // latency and stderr noise. CLI updates are managed out-of-band by the user.
    // Env var introduced in CLI 2.1.118; no-op on older CLIs.
    cli_args.env_overrides.push((
        "DISABLE_UPDATES".to_string(),
        "1".to_string(),
    ));
    // Conceal cwd from the CLI's startup banner and internal telemetry. Personas
    // runs each execution in a per-execution directory that may embed GUIDs or
    // temp paths; there is no reason for those to leak into CLI-side logs.
    // Env var introduced in CLI 2.1.119; no-op on older CLIs.
    cli_args.env_overrides.push((
        "CLAUDE_CODE_HIDE_CWD".to_string(),
        "1".to_string(),
    ));

    // Forward persona timeout as API_TIMEOUT_MS so the CLI's inner API request
    // timeout aligns with the persona's outer process-kill deadline. Subtract 5s
    // to give the CLI time to surface the timeout error cleanly before the
    // process is killed. Floor at 10s to avoid misconfigured tiny values.
    // Requires CLI ≥ 2.1.101 (which first honored API_TIMEOUT_MS).
    if let Some(p) = persona {
        if p.timeout_ms > 0 {
            let api_ms = (p.timeout_ms as u64).saturating_sub(5_000).max(10_000);
            cli_args
                .env_overrides
                .push(("API_TIMEOUT_MS".to_string(), api_ms.to_string()));
        }
    }

    cli_args
}

/// Build CLI arguments to resume an existing Claude session.
/// Uses `--resume <id>` instead of `-p -` to continue a prior conversation.
pub fn build_resume_cli_args(claude_session_id: &str) -> CliArgs {
    build_resume_cli_args_with_trace(claude_session_id, None)
}

/// Like [`build_resume_cli_args`], but also injects a W3C `TRACEPARENT` env
/// var so the resumed session stays linked to the originating trace.
pub fn build_resume_cli_args_with_trace(
    claude_session_id: &str,
    trace: Option<&super::super::trace::W3cTraceContext>,
) -> CliArgs {
    let mut cli_args = build_resume_cli_args_inner(claude_session_id);
    if let Some(t) = trace {
        cli_args
            .env_overrides
            .push(("TRACEPARENT".to_string(), t.traceparent_header()));
        if let Some(state) = t.tracestate_header() {
            cli_args.env_overrides.push(("TRACESTATE".to_string(), state));
        }
    }
    cli_args
}

pub(super) fn build_resume_cli_args_inner(claude_session_id: &str) -> CliArgs {
    let (command, mut args) = base_cli_setup();

    args.extend([
        "--resume".to_string(),
        claude_session_id.to_string(),
        "-p".to_string(),
        "-".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
        "--exclude-dynamic-system-prompt-sections".to_string(),
    ]);

    // Pin effort on resume too — keeps continued sessions on the same effort
    // policy as their initial run regardless of CLI version drift.
    args.push("--effort".to_string());
    args.push(DEFAULT_EFFORT.to_string());

    CliArgs {
        command,
        args,
        env_overrides: vec![
            // Suppress nonessential CLI traffic on resume too — see the matching
            // block in `build_cli_args`. Keeps resumed sessions on the same
            // privacy-positive defaults as fresh runs.
            (
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
                "1".to_string(),
            ),
            (
                "CLAUDE_CODE_DISABLE_TERMINAL_TITLE".to_string(),
                "1".to_string(),
            ),
            // Parity with fresh runs — see the matching block in `build_cli_args`.
            ("DISABLE_UPDATES".to_string(), "1".to_string()),
            ("CLAUDE_CODE_HIDE_CWD".to_string(), "1".to_string()),
        ],
        env_removals: vec![
            "CLAUDECODE".to_string(),
            "CLAUDE_CODE".to_string(),
            "DISABLE_PROMPT_CACHING".to_string(),
            "DISABLE_PROMPT_CACHING_1H".to_string(),
            "DISABLE_PROMPT_CACHING_5M".to_string(),
        ],
        cwd: None,
    }
}
