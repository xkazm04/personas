use crate::db::models::Persona;
use crate::engine::parser;
use crate::engine::prompt;
use crate::engine::types::{CliArgs, ModelProfile, StreamLineType};

use super::{CliProvider, PromptDelivery};

/// Claude Code CLI provider -- wraps the existing prompt/parser modules.
pub struct ClaudeProvider;

impl CliProvider for ClaudeProvider {
    fn engine_name(&self) -> &'static str {
        "Claude Code CLI"
    }

    fn context_file_name(&self) -> &'static str {
        "CLAUDE.md"
    }

    fn binary_candidates(&self) -> &[&str] {
        if cfg!(target_os = "windows") {
            &["claude", "claude.cmd", "claude.exe", "claude-code"]
        } else {
            &["claude", "claude-code"]
        }
    }

    fn supports_session_resume(&self) -> bool {
        true
    }

    fn prompt_delivery(&self) -> PromptDelivery {
        PromptDelivery::Stdin
    }

    fn build_execution_args(
        &self,
        persona: Option<&Persona>,
        model_profile: Option<&ModelProfile>,
    ) -> CliArgs {
        prompt::build_cli_args(persona, model_profile)
    }

    fn build_resume_args(&self, session_id: &str) -> CliArgs {
        prompt::build_resume_cli_args(session_id)
    }

    fn parse_stream_line(&self, line: &str) -> (StreamLineType, Option<String>) {
        parser::parse_stream_line(line)
    }

    fn apply_provider_env(&self, cli_args: &mut CliArgs, profile: &ModelProfile) {
        prompt::apply_provider_env(cli_args, profile);
    }

    fn minimum_version(&self) -> Option<&str> {
        // CLI ≥ 2.1.166 — floor advances when a newer CLI fixes the wrapping
        // contract personas depends on. Recent floor:
        // - 2.1.155–2.1.166: floor advanced past 2.1.154 because the prior
        //   floor ITSELF carries defects personas is exposed to. 2.1.163 fixes
        //   a `$TMPDIR` override (a regression introduced in 2.1.154) that
        //   repointed `/tmp/claude-{uid}` for EVERY command instead of only
        //   sandboxed ones, breaking the Bash tool under bazel / EDR-protected
        //   Go workflows (any tool-using persona). 2.1.156 fixes Opus 4.8
        //   thinking blocks being modified into API errors — personas runs 4.8
        //   (Athena's `claude-opus-4-8` pin + the `opus` alias auto-resolve),
        //   so the 2.1.154 floor exposed every 4.8 spawn. 2.1.163 also fixes
        //   `claude -p` hanging forever after its final result when a
        //   backgrounded command never exits (stdin closed) — squarely
        //   personas's spawn pattern (pipe prompt → close stdin; on the old
        //   floor this surfaced as a `timeout_ms` abort instead of a clean
        //   result), plus a Windows `EEXIST` on the session-env dir inside
        //   OneDrive / with a read-only attribute (Windows is the primary
        //   platform). 2.1.157 stops a sandbox network-permission PROMPT from
        //   appearing in bypass-permissions mode / SDK — a prompt in
        //   non-interactive `-p` under `--dangerously-skip-permissions` would
        //   hang the run. 2.1.166 fixes a Windows PowerShell command-validation
        //   hang (killed-process children holding output pipes) and adds
        //   thinking-disable controls (`MAX_THINKING_TOKENS=0` / `--thinking
        //   disabled`) for default-thinking models like 4.8 — NOT adopted
        //   (personas has no thinking knob today; deferred alongside the open
        //   companion-path `--effort`/cost decision). Passive BYOM/3P benefits:
        //   2.1.163 (`ANTHROPIC_API_KEY required` on Bedrock/Vertex/Foundry +
        //   `CI=true`), 2.1.161 (`forceLogin*` no longer blocks 3P provider
        //   sessions), 2.1.162 (read-only config dir surfaces an error instead
        //   of a blank startup hang), 2.1.161 (a failed parallel Bash no longer
        //   cancels its siblings). Everything else in the range is
        //   interactive-TUI / `claude agents` / background-session surface
        //   personas never reaches in `-p`. New OTEL features (2.1.157
        //   `tool_decision.tool_parameters`, 2.1.161 `OTEL_RESOURCE_ATTRIBUTES`
        //   metric labels) stay blocked by the no-exporter descoped entry. The
        //   `workflow` interactive trigger was renamed → `ultracode` (2.1.160),
        //   but the headless `Workflow` TOOL name is unchanged (the 2026-05-31
        //   init probe still finds it). 2.1.167/2.1.168 are pure "bug fixes and
        //   reliability" releases above the floor; 2.1.155/2.1.159/2.1.164 not
        //   user-facing. /research run 2026-06-08.
        // - 2.1.151–2.1.154: 2.1.151 not released upstream. 2.1.154 ships Opus
        //   4.8 + the `xhigh` effort tier (both already wired personas-side: the
        //   `opus` alias auto-resolves to 4.8, and `EFFORT_LEVELS` already
        //   carries `xhigh`) and — wrapping-relevant — fixes API 400 on models
        //   that don't support the effort parameter when effort is set, which
        //   matters because `build_cli_args` pins `--effort` on EVERY spawn
        //   unconditionally (`prompt/cli_args.rs:121`); the lean system prompt is
        //   now the default for Opus 4.8 (a token-cost shift to expect when the
        //   companion/brain `claude-opus-4-7` pins adopt 4.8). 2.1.153 fixes two
        //   defects squarely on personas's spawn surface: (a) a hang where the
        //   CLI failed to exit when stdin was closed without EOF in stream-json
        //   mode — personas pipes the prompt into stdin and closes it on every
        //   run; (b) a custom API gateway receiving the user's Anthropic OAuth
        //   credential instead of the gateway's own token — a BYOM credential
        //   leak for users on a custom `ANTHROPIC_BASE_URL` (`engine/byom.rs`);
        //   plus a stateful-MCP `tools/list` reconnect-loop regression (INBOUND
        //   MCP). 2.1.152 fixes `cache_creation_input_tokens` reporting 0, which
        //   improves the `total_cost_usd` personas trusts directly
        //   (`parser.rs:227`), and clears stuck sessions from stale thinking-block
        //   signatures after a model/login switch (passive on `--resume` chat
        //   sessions); `--fallback-model` session-switch (2.1.152) is
        //   informational — personas has its own `engine/failover.rs`.
        //   /research run 2026-05-28.
        // - 2.1.147–2.1.150: 2.1.150 is internal-only (no user-facing changes);
        //   2.1.149 is mostly interactive-TUI (`/usage` per-category breakdown,
        //   `/diff` keyboard scrolling) — none in the `-p`/stream-json wire — BUT
        //   ships PowerShell permission-bypass + sandbox-isolation security fixes
        //   that harden the exact spawn surface personas drives on Windows with
        //   `--dangerously-skip-permissions`, plus UI-freeze / transcript / Bash-
        //   perf bug fixes. 2.1.148 fixes a 2.1.147 regression where the Bash tool
        //   returned exit code 127 on *every* command — directly breaks tool-using
        //   personas, so pinning anywhere ≤2.1.147 is a known-bad floor. The
        //   2.1.149 GFM task-list-checkbox render is a non-event for personas: it
        //   parses stream-json and renders its own markdown via remark-gfm (which
        //   already supports task lists), never the CLI's TUI render.
        //   `allowAllClaudeAiMcps` (2.1.149) is an enterprise managed-MCP setting
        //   loading claude.ai *cloud* connectors — conflicts with the local-first
        //   credential model, so not adopted. Floor → 2.1.149 (highest release
        //   with a wrapping-relevant fix; 150 adds none). /research run 2026-05-23.
        // - 2.1.141–2.1.146: six releases, overwhelmingly Claude-Code-internal
        //   (the `claude agents`/`/bg` background-session swath, plugins, themes,
        //   terminal rendering) — none touch personas's `-p`/stream-json wrapping
        //   surface. Two items mattered for the Phase 6 catch pass: (a) the MCP
        //   `tools/list` pagination fix (2.1.144) + `resources/list`/`prompts/list`
        //   pagination fix (2.1.146) flagged the *same* defect in personas's own
        //   INBOUND MCP client `engine/mcp_tools.rs`, which followed no
        //   `nextCursor` cursor — fixed in the same /research run that advanced
        //   this floor; (b) the 2.1.143 `/goal`-evaluator-vs-background-shells
        //   fix is again informational only against the descoped `/goal` entry
        //   — it does not publish the `-p`-mode wire contract trigger (i)
        //   requires. Near-misses already mitigated here: api.anthropic.com
        //   startup-hang 15s timeout + pre-response stream-stall recovery
        //   (2.1.144) overlap personas's own `timeout_ms` + `engine/healing.rs`;
        //   Haiku side-query fallback fixes on Bedrock/Vertex/custom base URL
        //   (2.1.141, 2.1.144) benefit BYOM users passively.
        // - 2.1.140: pure upstream bug-fix release; no personas wrapping
        //   contract changes. None of the fixes affect `-p`/stream-json mode,
        //   `hooks_sidecar`, `cli_mcp_config`, or `build_cli_args` callers.
        //   Notable for the Phase 6 catch table: the `/goal` + `disableAllHooks`
        //   /`allowManagedHooksOnly` clear-message fix is informational only
        //   against the descoped `/goal` completion-condition entry in
        //   `Patterns/descoped-reopenable.md` (2026-05-11) — it confirms
        //   hooks-disabled state changes `/goal` availability, but does NOT
        //   publish the `-p`-mode wire contract (stream-json event variant
        //   signaling goal-met) that the entry's reconsider-trigger (i)
        //   requires. The Windows event-loop stall on missing-executable
        //   `where.exe` re-spawns is also a near-miss against personas's
        //   own `binary_probe.rs::BinaryProbeCache` (TTL-cached `where`/`which`
        //   results) — same root pattern, already mitigated here. Other items
        //   (`claude --bg`, remote managed settings 401, `/loop` redundant
        //   wakeups, `extraKnownMarketplaces` persistence, settings-hot-reload
        //   symlink misattribution, plugins component-folder warning, native
        //   terminal cursor, `subagent_type` case-insensitive matching, `Read`
        //   offset string validation, agent color palette) do not touch
        //   personas's wrapping surface.
        // - 2.1.139: stream watchdog no longer fires a spurious "stream idle
        //   timeout" 5 minutes after a response completed (real defect — the
        //   timer wasn't being cleared on stream cancellation, false-aborting
        //   long-running personas via `engine/runner/mod.rs`); silent `exit 1`
        //   on 10+ MCP servers + unwritable cache dir now surfaces the
        //   underlying cause (matters for personas users wiring many INBOUND
        //   MCP gateways via `mcp_gateway` connector); HTTP/SSE MCP response
        //   bodies capped at 16 MB per SSE frame to defend `engine/mcp_tools.rs`
        //   INBOUND consumers against misbehaving servers streaming
        //   non-protocol data; hooks now run without terminal access so a
        //   hook writing to the terminal can no longer corrupt an interactive
        //   prompt (hardens the `hooks_sidecar.rs` contract); new hook
        //   `args: string[]` exec-form field eliminates shell quoting (see
        //   sibling commit converting `build_settings_json` to use it).
        //   2.1.134 and 2.1.135 were skipped upstream; 2.1.130 was also skipped.
        //   Earlier 2.1.136 narrative (OAuth parallel-spawn, MCP refresh, path
        //   underscores, worktree errors) — see git history of this file.
        // - 2.1.128: `claude -p` no longer crashes on >10MB stdin; MCP tool
        //   results preserve images when servers return mixed content blocks;
        //   sub-agent progress summaries hit prompt cache; parallel shell
        //   tool-call siblings survive single-failure cancellation. 2.1.127
        //   was skipped upstream.
        // Earlier floors (2.1.121–2.1.126) elided — see git history of this
        // file for the alwaysLoad / hooks-sidecar / sandbox-scope / OAuth
        // narrative. The 2026-05-01 sandbox-erosion threat model recorded
        // against the 2.1.126 floor lives in `Patterns/descoped-reopenable.md`.
        // The check is advisory: `provider::check_cli_version` returns an Err
        // string below the floor; no caller turns that into a hard refusal.
        Some("2.1.166")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_name() {
        let provider = ClaudeProvider;
        assert_eq!(provider.engine_name(), "Claude Code CLI");
    }

    #[test]
    fn test_prompt_delivery() {
        let provider = ClaudeProvider;
        assert_eq!(provider.prompt_delivery(), PromptDelivery::Stdin);
    }

    #[test]
    fn test_supports_session_resume() {
        let provider = ClaudeProvider;
        assert!(provider.supports_session_resume());
    }

    #[test]
    fn test_parse_system_init() {
        let provider = ClaudeProvider;
        let line = r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-20250514","session_id":"sess-123"}"#;
        let (st, display) = provider.parse_stream_line(line);

        match st {
            StreamLineType::SystemInit {
                model,
                session_id,
                plugin_errors,
            } => {
                assert_eq!(model, "claude-sonnet-4-20250514");
                assert_eq!(session_id, Some("sess-123".to_string()));
                assert!(plugin_errors.is_empty());
            }
            _ => panic!("Expected SystemInit, got {st:?}"),
        }
        assert!(display.is_some());
    }

    #[test]
    fn test_parse_result() {
        let provider = ClaudeProvider;
        let line = r#"{"type":"result","duration_ms":5200,"total_cost_usd":0.0123,"total_input_tokens":1500,"total_output_tokens":800}"#;
        let (st, _) = provider.parse_stream_line(line);

        match st {
            StreamLineType::Result { total_cost_usd, .. } => {
                assert_eq!(total_cost_usd, Some(0.0123));
            }
            _ => panic!("Expected Result, got {st:?}"),
        }
    }

    #[test]
    fn test_build_execution_args() {
        let provider = ClaudeProvider;
        let args = provider.build_execution_args(None, None);
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
        assert!(args
            .args
            .contains(&"--exclude-dynamic-system-prompt-sections".to_string()));
    }

    #[test]
    fn test_build_execution_args_pins_effort_medium() {
        // Personas pins --effort medium so behavior stays deterministic across
        // CLI 2.1.94's tier-dependent default change.
        let provider = ClaudeProvider;
        let args = provider.build_execution_args(None, None);
        assert!(args.args.contains(&"--effort".to_string()));
        assert!(args.args.contains(&"medium".to_string()));
    }

    #[test]
    fn test_minimum_version_is_set() {
        let provider = ClaudeProvider;
        let min = provider.minimum_version();
        assert!(min.is_some());
        assert_eq!(min.unwrap(), "2.1.166");
    }
}
