//! The engine seam: one [`build_launch`] that turns a resolved tier plus the
//! turn's inputs into the exact process invocation for that engine, so
//! `cli.rs` only spawns and reads.
//!
//! Hybrid-LLM-engine spark (2026-09-17), WP1. Two arms:
//!
//! - **Claude** reproduces the argv `cli.rs` carried until this file existed,
//!   byte for byte (`claude_argv_is_byte_identical_to_the_pre_seam_flag_list`
//!   pins it). The system prompt goes through `--system-prompt-file` because
//!   it exceeds the Windows argument limit; the user message goes to stdin.
//! - **Grok** (xAI Grok Build CLI 1.0.34, measured on this machine) runs
//!   headless: `-p <message> --agent <profile.md> --tools "" --max-turns 1
//!   -m <model> --effort <level> --output-format streaming-messages-json
//!   --include-partial-messages [--resume <id>]`. The composed system prompt
//!   becomes the body of an agent profile file (YAML frontmatter + prompt);
//!   `--system-prompt-override` is argv-only (150 KB → `ENAMETOOLONG`) and
//!   defeats caching, so it is never used. Grok's login default effort is
//!   `xhigh`, a ~3x-slower surprise for a chat turn, so an unset effort is
//!   passed as `low`.
//!
//! Temp files the launch creates (prompt file, agent profile, MCP configs)
//! live exactly as long as the [`AthenaLaunch`] value: `Drop` removes them,
//! which also covers the turn-timeout path that used to leak the prompt file.
//!
//! [`probe_engines`] answers Settings > Engine through the same binary
//! resolution the real turn uses (registry
//! `agent-cli-transport/availability-probe`): a missing binary is
//! `installed: false` with a reason, never an error.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::companion::engine_settings::{AthenaEngine, EngineAvailability, ResolvedTier};
use crate::error::AppError;

/// How the user message reaches the child.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptDelivery {
    /// Written to the child's stdin, then stdin closed (Claude `-p -`).
    Stdin,
    /// Already on argv (Grok `-p <message>`); stdin is closed immediately.
    Positional,
}

/// The turn's inputs that shape the invocation. Borrowed: the spawn owns
/// nothing the turn does not already hold.
pub struct LaunchCtx<'a> {
    pub turn_id: &'a str,
    pub session_id: &'a str,
    /// The engine's own session pointer for `--resume`, when the conversation
    /// has one.
    pub resume_session_id: Option<&'a str>,
    pub system_prompt: &'a str,
    pub user_message: &'a str,
    /// Hand this single spawn browser tools via MCP (browser-test turns).
    pub browser_tools: bool,
    /// `None` = the user's home dir; `Some` roots a build turn in its project.
    pub cwd_override: Option<&'a Path>,
    /// Per-project MCP connectors for a build turn (C8). Empty = none.
    pub mcp: &'a [String],
}

/// One fully-shaped process invocation. Build it, spawn it, keep it alive
/// until the child has exited (its temp files go with it).
pub struct AthenaLaunch {
    pub engine: AthenaEngine,
    pub program: PathBuf,
    pub argv: Vec<String>,
    pub prompt_delivery: PromptDelivery,
    /// Grok: the agent profile carrying the system prompt.
    pub agent_profile_path: Option<PathBuf>,
    /// Claude: the `--system-prompt-file`.
    pub system_prompt_path: Option<PathBuf>,
    /// Working directory for the child.
    pub cwd: PathBuf,
    /// MCP config files referenced from `argv`; `NamedTempFile` deletes on
    /// drop, so they must outlive the child.
    _mcp_configs: Vec<tempfile::NamedTempFile>,
}

impl Drop for AthenaLaunch {
    fn drop(&mut self) {
        // Best-effort: a file the child still holds (Windows) or one that is
        // already gone is not worth a warning.
        for p in [&self.agent_profile_path, &self.system_prompt_path]
            .into_iter()
            .flatten()
        {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// The `fallback_reason` token recorded when a tier asks for an engine whose
/// binary is not installed and the turn ran on Claude instead.
pub const FALLBACK_ENGINE_MISSING: &str = "engine_missing";

/// The engine a turn actually runs on, given the tier the operator chose.
///
/// A Grok tier whose binary cannot be found falls back to Claude on the MAIN
/// calibrated defaults (the tier's own model is a grok id, useless to
/// claude) and the turn record says so. Logged at `warn` once per process:
/// every turn hitting the same missing binary is one fact, not a log line
/// per turn.
pub fn effective_tier(tier: &ResolvedTier) -> (ResolvedTier, Option<&'static str>) {
    if tier.engine != AthenaEngine::Grok {
        return (tier.clone(), None);
    }
    if crate::engine::cli_process::resolve_grok_exe().is_some() {
        return (tier.clone(), None);
    }
    static WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if !WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        tracing::warn!(
            class = tier.class.as_str(),
            "companion: grok engine selected but the grok CLI is not installed (PERSONAS_GROK_EXE, ~/.grok/bin, PATH); running on claude"
        );
    }
    let main = &crate::companion::model_routing::MAIN;
    (
        ResolvedTier {
            class: tier.class,
            engine: AthenaEngine::Claude,
            model: main.model.to_string(),
            effort: main.effort.map(String::from),
        },
        Some(FALLBACK_ENGINE_MISSING),
    )
}

/// Build the invocation for `engine`. `tier` supplies model + effort;
/// `engine` is passed separately so the caller states which arm it decided
/// on after [`effective_tier`] (a mismatch is a caller bug, not a fallback).
pub fn build_launch(
    engine: AthenaEngine,
    tier: &ResolvedTier,
    ctx: &LaunchCtx<'_>,
) -> Result<AthenaLaunch, AppError> {
    match engine {
        AthenaEngine::Claude => build_claude(tier, ctx),
        AthenaEngine::Grok => build_grok(tier, ctx),
    }
}

fn home_or_temp() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir)
}

fn build_claude(tier: &ResolvedTier, ctx: &LaunchCtx<'_>) -> Result<AthenaLaunch, AppError> {
    let (program, mut argv) = crate::engine::cli_process::claude_cli_invocation();

    // Resume if we have a session id, otherwise fresh.
    if let Some(sid) = ctx.resume_session_id {
        argv.extend(["--resume".into(), sid.into()]);
    }

    // Write the system prompt to a temp file. Inline `--system-prompt`
    // works on small prompts but breaks at the OS arg-length limit
    // (Windows ~32k); the prompt grows fast once retrieval kicks in.
    let prompt_file = write_temp_file("athena-prompt", ctx.turn_id, ctx.system_prompt)?;

    // --system-prompt-file fully replaces Claude Code's default identity
    // prompt. We avoid `--bare` because it disables OAuth/keychain auth
    // and would force the user to set ANTHROPIC_API_KEY explicitly.
    // Default Claude Code framework loads, but our prompt dominates.
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        // Token-level streaming: the CLI additionally emits
        // `{"type":"stream_event", ...}` lines carrying `content_block_delta`
        // / `text_delta` chunks *before* the final whole `assistant` message,
        // which the frontend renders live. Harmless on older CLIs.
        "--include-partial-messages".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        tier.model.clone(),
        "--system-prompt-file".into(),
        prompt_file.to_string_lossy().to_string(),
    ]);

    // Chat turns run on the resolved tier's effort (env → setting →
    // `model_routing`); build turns arrive with their pinned effort already in
    // the tier. `None` leaves the CLI on the model's default.
    if let Some(effort) = &tier.effort {
        argv.push("--effort".into());
        argv.push(effort.clone());
    }

    let mut mcp_configs = Vec::new();

    // Browser-test turns: hand this single CLI spawn browser tools via MCP —
    // the browser-bridge endpoint (user's real Chrome through the paired
    // extension) when one is connected, else the bundled Playwright MCP.
    // Continuation/regular turns never get it (startup cost + tool surface
    // stay scoped to the test).
    if ctx.browser_tools {
        match crate::browser_bridge::build_browser_mcp_config() {
            Ok((f, mode)) => {
                tracing::info!(?mode, "browser-test turn: browser MCP config ready");
                argv.push("--mcp-config".into());
                argv.push(f.path().to_string_lossy().to_string());
                mcp_configs.push(f);
            }
            Err(e) => tracing::warn!(
                error = %e,
                "browser-test turn: failed to build browser MCP config; running without browser tools"
            ),
        }
    }

    // Build turns can load per-project MCP connectors the user toggled on (C8).
    if ctx.cwd_override.is_some() && !ctx.mcp.is_empty() {
        if let Some(cfg) = crate::webbuild::mcp::build_config(ctx.mcp) {
            if let Ok(mut f) = tempfile::Builder::new().suffix(".json").tempfile() {
                use std::io::Write as _;
                if write!(f, "{cfg}").is_ok() {
                    argv.push("--mcp-config".into());
                    argv.push(f.path().to_string_lossy().to_string());
                    mcp_configs.push(f);
                }
            }
        }
    }

    // Spawn from the user's home directory by default so a normal turn
    // doesn't auto-pick up the Personas project's CLAUDE.md. A build session
    // overrides this to root the turn in its project directory.
    let cwd = ctx
        .cwd_override
        .map(Path::to_path_buf)
        .unwrap_or_else(home_or_temp);

    Ok(AthenaLaunch {
        engine: AthenaEngine::Claude,
        program: PathBuf::from(program),
        argv,
        prompt_delivery: PromptDelivery::Stdin,
        agent_profile_path: None,
        system_prompt_path: Some(prompt_file),
        cwd,
        _mcp_configs: mcp_configs,
    })
}

/// Grok's default effort when the tier leaves it unset. The login default is
/// `xhigh`; measured ~3x slower to first text than `low` on the Athena prompt.
const GROK_DEFAULT_EFFORT: &str = "low";

fn build_grok(tier: &ResolvedTier, ctx: &LaunchCtx<'_>) -> Result<AthenaLaunch, AppError> {
    let program = crate::engine::cli_process::resolve_grok_exe().ok_or_else(|| {
        AppError::ProcessSpawn(
            "grok CLI not found (looked at PERSONAS_GROK_EXE, ~/.grok/bin, PATH)".into(),
        )
    })?;
    let profile = write_temp_file(
        "athena-agent",
        ctx.turn_id,
        &grok_agent_profile(ctx.turn_id, ctx.session_id, ctx.system_prompt),
    )?;
    Ok(AthenaLaunch {
        engine: AthenaEngine::Grok,
        program,
        argv: grok_argv(
            tier,
            ctx.user_message,
            &profile.to_string_lossy(),
            ctx.resume_session_id,
        ),
        prompt_delivery: PromptDelivery::Positional,
        agent_profile_path: Some(profile),
        system_prompt_path: None,
        // Always home: grok reads `~/.claude` compat files wherever it runs
        // and a build turn never lands on this arm (see `cli.rs`).
        cwd: home_or_temp(),
        _mcp_configs: Vec::new(),
    })
}

/// The grok argv, pure so the snapshot tests need no filesystem.
fn grok_argv(
    tier: &ResolvedTier,
    user_message: &str,
    profile_path: &str,
    resume_session_id: Option<&str>,
) -> Vec<String> {
    let mut argv: Vec<String> = [
        "-p",
        user_message,
        "--agent",
        profile_path,
        "--tools",
        "",
        "--max-turns",
        "1",
        "-m",
        &tier.model,
        "--effort",
        tier.effort.as_deref().unwrap_or(GROK_DEFAULT_EFFORT),
        "--output-format",
        "streaming-messages-json",
        "--include-partial-messages",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if let Some(sid) = resume_session_id {
        argv.extend(["--resume".into(), sid.into()]);
    }
    argv
}

/// The grok agent profile: YAML frontmatter, a blank line, the composed
/// system prompt as the body. The name carries the turn's short id and the
/// description its conversation, so a profile left behind by a crash is
/// attributable.
fn grok_agent_profile(turn_id: &str, session_id: &str, system_prompt: &str) -> String {
    format!(
        "---\nname: athena-{}\ndescription: Athena companion turn (conversation {session_id})\n---\n\n{system_prompt}",
        short_turn_id(turn_id)
    )
}

/// `turn_abc123…` → `abc123…`, capped so a file name stays short.
fn short_turn_id(turn_id: &str) -> &str {
    let id = turn_id.rsplit('_').next().unwrap_or(turn_id);
    id.get(..12).unwrap_or(id)
}

fn write_temp_file(stem: &str, turn_id: &str, content: &str) -> Result<PathBuf, AppError> {
    let path = std::env::temp_dir().join(format!(
        "{stem}-{}-{}.md",
        short_turn_id(turn_id),
        crate::companion::util::short_id(6)
    ));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("write {stem} file: {e}")))?;
    Ok(path)
}

/// Strip the env that would make the child think it runs nested inside a
/// Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`). Grok reads the same
/// variables through its Claude-compat layer, so both arms want it.
pub fn strip_nesting_env(cmd: &mut Command) {
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().starts_with("CLAUDE_CODE_") {
            cmd.env_remove(k);
        }
    }
}

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Probe both engines: `<bin> --version`, plus `grok models` for the model
/// list. Missing binary → `installed: false` with a reason; a binary that
/// exists but fails its probe → `installed: false` with the failure.
pub async fn probe_engines() -> Vec<EngineAvailability> {
    let mut out = Vec::with_capacity(AthenaEngine::ALL.len());
    for engine in AthenaEngine::ALL {
        out.push(match engine {
            AthenaEngine::Claude => probe_claude().await,
            AthenaEngine::Grok => probe_grok().await,
        });
    }
    out
}

async fn probe_claude() -> EngineAvailability {
    let (program, leading) = crate::engine::cli_process::claude_cli_invocation();
    let mut argv = leading;
    argv.push("--version".into());
    let models = vec![
        personas_core::model_ids::OPUS_CURRENT.to_string(),
        personas_core::model_ids::SONNET_CURRENT.to_string(),
        personas_core::model_ids::HAIKU_CURRENT.to_string(),
    ];
    match run_probe(Path::new(&program), &argv).await {
        Ok(out) => EngineAvailability {
            engine: AthenaEngine::Claude,
            installed: true,
            version: Some(out.trim().to_string()),
            models,
            detail: None,
        },
        Err(detail) => EngineAvailability {
            engine: AthenaEngine::Claude,
            installed: false,
            version: None,
            models: Vec::new(),
            detail: Some(detail),
        },
    }
}

async fn probe_grok() -> EngineAvailability {
    let not_installed = |detail: String| EngineAvailability {
        engine: AthenaEngine::Grok,
        installed: false,
        version: None,
        models: Vec::new(),
        detail: Some(detail),
    };
    let Some(exe) = crate::engine::cli_process::resolve_grok_exe() else {
        return not_installed(
            "grok CLI not found (looked at PERSONAS_GROK_EXE, ~/.grok/bin, PATH)".into(),
        );
    };
    let version = match run_probe(&exe, &["--version".to_string()]).await {
        Ok(v) => v.trim().to_string(),
        Err(e) => return not_installed(e),
    };
    // A models failure (not logged in, network) leaves the engine usable
    // with the catalog list; the detail says why the list is not live.
    let (models, detail) = match run_probe(&exe, &["models".to_string()]).await {
        Ok(out) => (parse_grok_models(&out), None),
        Err(e) => (
            personas_core::model_ids::GROK_MODELS
                .iter()
                .map(|m| m.to_string())
                .collect(),
            Some(format!("grok models: {e}")),
        ),
    };
    EngineAvailability {
        engine: AthenaEngine::Grok,
        installed: true,
        version: Some(version),
        models,
        detail,
    }
}

/// Parse `grok models` output: the `* grok-4.6 (default)` / `- grok-4.5`
/// lines under `Available models:`. The default is listed first.
pub fn parse_grok_models(out: &str) -> Vec<String> {
    let mut default: Option<String> = None;
    let mut rest = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        let (marker, body) = match line.split_once(' ') {
            Some((m @ ("*" | "-"), b)) => (m, b),
            _ => continue,
        };
        let Some(id) = body.split_whitespace().next() else {
            continue;
        };
        if !id.starts_with("grok") {
            continue;
        }
        if marker == "*" || body.contains("(default)") {
            default = Some(id.to_string());
        } else {
            rest.push(id.to_string());
        }
    }
    default.into_iter().chain(rest).collect()
}

/// Run one short probe process and return its stdout. `Err` carries a
/// human-readable reason (spawn failure, non-zero exit, timeout).
async fn run_probe(program: &Path, argv: &[String]) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(argv)
        .current_dir(home_or_temp())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    strip_nesting_env(&mut cmd);
    super::cli::apply_no_console_window(&mut cmd);
    cmd.kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|e| format!("{}: {e}", program.display()))?;
    let out = tokio::time::timeout(PROBE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "{} did not answer within {}s",
                program.display(),
                PROBE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("{}: {e}", program.display()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "{} exited with {}: {}",
            program.display(),
            out.status,
            crate::utils::text::truncate_on_char_boundary(err.trim(), 200)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::engine_settings::TurnTierClass;

    /// Tests that touch `PERSONAS_GROK_EXE` serialise on this so a bogus
    /// override set by one cannot leak into another's resolution.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn tier(engine: AthenaEngine, model: &str, effort: Option<&str>) -> ResolvedTier {
        ResolvedTier {
            class: TurnTierClass::Main,
            engine,
            model: model.into(),
            effort: effort.map(String::from),
        }
    }

    fn ctx<'a>(resume: Option<&'a str>, cwd: Option<&'a Path>) -> LaunchCtx<'a> {
        LaunchCtx {
            turn_id: "turn_abcdef123456",
            session_id: "default",
            resume_session_id: resume,
            system_prompt: "You are Athena.",
            user_message: "hello",
            browser_tools: false,
            cwd_override: cwd,
            mcp: &[],
        }
    }

    /// The flag list `cli.rs` carried before the seam, in its order. The
    /// prompt path is the only per-run value; everything else is pinned.
    #[test]
    fn claude_argv_is_byte_identical_to_the_pre_seam_flag_list() {
        let _g = ENV_LOCK.lock().unwrap();
        let (_, leading) = crate::engine::cli_process::claude_cli_invocation();
        let t = tier(AthenaEngine::Claude, "claude-opus-5", Some("low"));
        let launch = build_launch(AthenaEngine::Claude, &t, &ctx(None, None)).unwrap();
        let prompt = launch.system_prompt_path.clone().unwrap();
        let mut expected = leading;
        expected.extend(
            [
                "-p",
                "-",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--dangerously-skip-permissions",
                "--exclude-dynamic-system-prompt-sections",
                "--model",
                "claude-opus-5",
                "--system-prompt-file",
                &prompt.to_string_lossy(),
                "--effort",
                "low",
            ]
            .map(String::from),
        );
        assert_eq!(launch.argv, expected);
        assert_eq!(launch.prompt_delivery, PromptDelivery::Stdin);
        assert!(launch.agent_profile_path.is_none());
        assert_eq!(std::fs::read_to_string(&prompt).unwrap(), "You are Athena.");
        drop(launch);
        assert!(!prompt.exists(), "the prompt file goes with the launch");
    }

    #[test]
    fn claude_resume_and_build_variants() {
        let _g = ENV_LOCK.lock().unwrap();
        let t = tier(AthenaEngine::Claude, "claude-opus-5", Some("xhigh"));
        let cwd = std::env::temp_dir();
        let launch =
            build_launch(AthenaEngine::Claude, &t, &ctx(Some("sid-1"), Some(&cwd))).unwrap();
        let (_, leading) = crate::engine::cli_process::claude_cli_invocation();
        // `--resume` sits right after the program's leading args, before `-p`.
        assert_eq!(
            &launch.argv[leading.len()..leading.len() + 3],
            ["--resume", "sid-1", "-p"]
        );
        assert_eq!(&launch.argv[launch.argv.len() - 2..], ["--effort", "xhigh"]);
        assert_eq!(launch.cwd, cwd, "a build turn is rooted in its project");

        // `effort: None` leaves the CLI on the model default: no flag at all.
        let t = tier(AthenaEngine::Claude, "claude-opus-5", None);
        let launch = build_launch(AthenaEngine::Claude, &t, &ctx(None, None)).unwrap();
        assert!(!launch.argv.iter().any(|a| a == "--effort"));
    }

    #[test]
    fn grok_argv_matches_the_measured_headless_invocation() {
        let t = tier(AthenaEngine::Grok, "grok-4.6", Some("medium"));
        assert_eq!(
            grok_argv(&t, "hello there", "C:/tmp/athena-agent-x.md", None),
            [
                "-p",
                "hello there",
                "--agent",
                "C:/tmp/athena-agent-x.md",
                "--tools",
                "",
                "--max-turns",
                "1",
                "-m",
                "grok-4.6",
                "--effort",
                "medium",
                "--output-format",
                "streaming-messages-json",
                "--include-partial-messages",
            ]
        );
        // Resume variant: appended last.
        let argv = grok_argv(
            &t,
            "hi",
            "p.md",
            Some("01a0af21-8233-71d2-9fe6-35b8b652b904"),
        );
        assert_eq!(
            &argv[argv.len() - 2..],
            ["--resume", "01a0af21-8233-71d2-9fe6-35b8b652b904"]
        );
        // Effort default: never the login's xhigh.
        let t = tier(AthenaEngine::Grok, "grok-4.6", None);
        let argv = grok_argv(&t, "hi", "p.md", None);
        let i = argv.iter().position(|a| a == "--effort").unwrap();
        assert_eq!(argv[i + 1], "low");
    }

    #[test]
    fn grok_profile_is_frontmatter_blank_line_then_the_prompt() {
        let p = grok_agent_profile(
            "turn_abcdef123456",
            "default",
            "# Athena\n\nYou are Athena.",
        );
        assert_eq!(
            p,
            "---\nname: athena-abcdef123456\ndescription: Athena companion turn (conversation default)\n---\n\n# Athena\n\nYou are Athena."
        );
        assert_eq!(short_turn_id("wbturn_0123456789abcdef"), "0123456789ab");
    }

    #[test]
    fn grok_launch_writes_the_profile_and_never_puts_the_prompt_on_argv() {
        let _g = ENV_LOCK.lock().unwrap();
        let Some(_) = crate::engine::cli_process::resolve_grok_exe() else {
            eprintln!("grok not installed here; skipping the on-disk profile check");
            return;
        };
        let t = tier(AthenaEngine::Grok, "grok-4.6", None);
        let launch = build_launch(AthenaEngine::Grok, &t, &ctx(None, None)).unwrap();
        let profile = launch.agent_profile_path.clone().unwrap();
        assert!(std::fs::read_to_string(&profile)
            .unwrap()
            .ends_with("\n\nYou are Athena."));
        assert!(!launch.argv.iter().any(|a| a.contains("You are Athena")));
        assert_eq!(launch.prompt_delivery, PromptDelivery::Positional);
        assert_eq!(launch.cwd, home_or_temp());
        drop(launch);
        assert!(!profile.exists());
    }

    /// The fallback ladder: a Grok tier with no binary runs on Claude's MAIN
    /// defaults and says why. Exercised both through the pure resolver and
    /// through the real env override.
    #[test]
    fn missing_grok_binary_falls_back_to_claude_main_defaults() {
        let _g = ENV_LOCK.lock().unwrap();
        let bogus = std::env::temp_dir().join("definitely-not-grok-4f9a.exe");
        assert_eq!(
            crate::engine::cli_process::resolve_grok_exe_from(
                Some(bogus.clone().into_os_string()),
                dirs::home_dir(),
                std::env::var_os("PATH"),
            ),
            None,
            "an explicit override that does not exist must not fall through"
        );
        std::env::set_var("PERSONAS_GROK_EXE", &bogus);
        let t = tier(AthenaEngine::Grok, "grok-4.6", Some("high"));
        let (eff, reason) = effective_tier(&t);
        std::env::remove_var("PERSONAS_GROK_EXE");
        assert_eq!(reason, Some(FALLBACK_ENGINE_MISSING));
        assert_eq!(eff.engine, AthenaEngine::Claude);
        assert_eq!(eff.model, crate::companion::model_routing::MAIN.model);
        assert_eq!(
            eff.effort.as_deref(),
            crate::companion::model_routing::MAIN.effort
        );
        assert_eq!(eff.class, TurnTierClass::Main);

        // A Claude tier is passed through untouched.
        let t = tier(AthenaEngine::Claude, "claude-sonnet-4-6", None);
        assert_eq!(effective_tier(&t), (t.clone(), None));
    }

    #[test]
    fn parses_grok_models_listing() {
        let out = "You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n";
        assert_eq!(parse_grok_models(out), ["grok-4.6", "grok-4.5"]);
        // Default listed second still comes first; noise lines are ignored.
        let out = "Available models:\n  - grok-4.5\n  * grok-4.6 (default)\n  - not-a-model\n";
        assert_eq!(parse_grok_models(out), ["grok-4.6", "grok-4.5"]);
        assert!(parse_grok_models("").is_empty());
    }

    #[test]
    fn stale_resume_wording_from_both_engines_is_recognised() {
        use super::super::cli::is_stale_session_error;
        // grok 1.0.34, captured 2026-09-17 with a bogus --resume id (exit 1).
        let grok = AppError::Internal(
            "grok exited with status exit code: 1: Session \"00000000-0000-4000-8000-000000000000\" not found locally, restoring conversation from remote...\nError: Failed to restore session from remote: fetching session record: session get failed: 404 Not Found".into(),
        );
        assert!(is_stale_session_error(&grok));
        let claude = AppError::Internal("No conversation found with session ID: abc".into());
        assert!(is_stale_session_error(&claude));
        assert!(!is_stale_session_error(&AppError::Internal(
            "claude exited with status 1: overloaded".into()
        )));
    }

    /// Live: spawn a real grok turn through the launch (HYBRID_LIVE=1 only).
    /// Proves the stream yields text deltas before a `result` carrying usage,
    /// and prints the spawn-to-first-text number.
    #[tokio::test]
    async fn live_grok_turn_streams_text_then_result() {
        if std::env::var("HYBRID_LIVE").is_err() {
            return;
        }
        use tokio::io::{AsyncBufReadExt, BufReader};
        let t = tier(AthenaEngine::Grok, "grok-4.6", Some("low"));
        let c = LaunchCtx {
            user_message: "Reply with one short sentence greeting me.",
            ..ctx(None, None)
        };
        let launch = build_launch(AthenaEngine::Grok, &t, &c).unwrap();
        let mut cmd = Command::new(&launch.program);
        cmd.args(&launch.argv)
            .current_dir(&launch.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        strip_nesting_env(&mut cmd);
        super::super::cli::apply_no_console_window(&mut cmd);
        let started = std::time::Instant::now();
        let mut child = cmd.spawn().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut first_text_ms = None;
        let mut usage = None;
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if first_text_ms.is_none() && super::super::cli::is_text_delta(&v) {
                first_text_ms = Some(started.elapsed().as_millis() as i64);
            }
            if let Some(u) = crate::companion::turn_ledger::CliUsage::from_result_event(&v) {
                usage = Some(u);
            }
        }
        let status = child.wait().await.unwrap();
        let total_ms = started.elapsed().as_millis();
        eprintln!(
            "HYBRID_LIVE grok: exit={status} first_text_ms={first_text_ms:?} total_ms={total_ms} usage={usage:?}"
        );
        assert!(status.success());
        let u = usage.expect("a result line with usage");
        assert!(u.input_tokens.is_some() && u.output_tokens.is_some());
        assert!(first_text_ms.is_some_and(|ms| ms > 0));
    }

    /// Live: the probe reports grok installed with both models, and a bogus
    /// override reports not-installed without erroring (HYBRID_LIVE=1 only).
    #[tokio::test]
    async fn live_probe_reports_grok_models_and_bogus_override() {
        if std::env::var("HYBRID_LIVE").is_err() {
            return;
        }
        let avail = probe_engines().await;
        eprintln!("HYBRID_LIVE probe: {avail:?}");
        let grok = avail
            .iter()
            .find(|a| a.engine == AthenaEngine::Grok)
            .unwrap();
        assert!(grok.installed);
        assert_eq!(grok.models, ["grok-4.6", "grok-4.5"]);
        assert!(grok.version.as_deref().unwrap_or("").starts_with("grok "));

        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("PERSONAS_GROK_EXE", "C:/nope/grok.exe");
        let bogus = probe_grok().await;
        std::env::remove_var("PERSONAS_GROK_EXE");
        eprintln!("HYBRID_LIVE probe (bogus): {bogus:?}");
        assert!(!bogus.installed);
        assert!(bogus.detail.as_deref().unwrap_or("").contains("not found"));
    }
}
