# Subscription-resilient execution via interactive PTY (Option C)

> **Status: contingency design — NOT built, NOT scheduled.** This is a ready-to-pull
> alternative execution path that keeps persona executions on the **monthly Claude
> subscription** if Anthropic ever moves `claude -p` (headless print mode) off
> subscription rate limits. Today the default path (`claude -p` over piped stdio)
> works on the subscription and nothing here is active. Build this only when an
> activation trigger below fires.

## 1. Motivation

In May 2026 Anthropic announced that the Agent SDK, `claude -p`, and third-party
apps built on the SDK would stop drawing from subscription rate limits and move to
a separate monthly credit. In June 2026 they **deferred** that change indefinitely
("we're working to update the plan to better support how users build with Claude
subscriptions") — nothing changed, subscription limits unchanged, advance notice
promised before any future change.

Our entire execution engine is `claude -p` on the subscription **by deliberate
design**: `engine/cli_process.rs::force_subscription_auth` strips
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` from *every*
spawn so the CLI falls back to subscription OAuth (user directive 2026-06-11). That
makes us precisely the usage pattern the deferred change targeted. The deferral is a
reprieve, not a guarantee.

**The API-key fallback (Option A) is explicitly the last resort** — pay-per-token is
far less cost-efficient than the flat-rate subscription for our volume ("dozens of
`-p` spawns per session"). This document designs the path that keeps the
subscription's economics intact.

## 2. The exposure is the *auth path*, not the `-p` flag

The thing to internalize: Anthropic's policy is about **using the subscription
programmatically**, and it named three entry points (SDK, `claude -p`, third-party
apps on the SDK). Interactive Claude Code — the TUI a human drives — was **not**
named. The (deferred) line was drawn between *headless/programmatic* and
*interactive human-in-the-loop*.

Option C exploits that line: drive the **interactive** CLI inside a pseudo-terminal
(PTY) rather than invoking `claude -p`. We already do exactly this for Fleet
(`commands/fleet/pty.rs`), on the subscription, today.

### The central caveat (read before relying on this)

This is a distinction of **letter, not spirit**. An app fanning out many automated
interactive sessions on one subscription is still programmatic subscription use;
Anthropic could close the wording in a single release, or detect PTY-driven
automation. Option C is therefore a **hedge that buys time and optionality**, not a
permanent guarantee. Its real value:

- It is **strictly better positioned** than `claude -p` if the policy returns
  worded exactly as the May announcement was (it named `-p`, not interactive).
- It keeps the door open without paying API per-token rates.
- The single-user, local-desktop, own-subscription, own-work shape is the *least
  abusive* programmatic pattern — relevant to how any future policy would likely
  treat us, but not a technical exemption.

If the policy returns worded against *all* programmatic subscription use, Option C
does **not** save us and Option A (API key) or Option D (non-Anthropic provider)
becomes the answer. Keep all three on the board.

## 3. Why this is robust, not a TUI-scraping hack

The naive version of "drive interactive Claude" is to parse the rendered terminal
(ANSI codes, spinners, boxes). That is brittle and would break on every CLI version
bump. **We do not do that.** The codebase already has the two pieces that let us
recover a clean machine contract from an interactive session:

1. **The per-session transcript JSONL.** Claude Code writes every turn to
   `<session-id>.jsonl` using the *same* message shapes our stream-json parser
   already consumes:
   - `{"type":"assistant","message":{"content":[{"type":"text"...},{"type":"tool_use"...}]}}`
   - `{"type":"user","message":{"content":[{"type":"tool_result"...}]}}`

   `engine/cli_session_awareness/transcript.rs` already tolerantly parses this exact
   file (`read_recent_turns` / `parse_turn` / `extract_text_blocks`). Our protocol
   messages (`user_message`, `emit_event`, `agent_memory`, `outcome_assessment`,
   `kpi_measurement`, …) are emitted by the model *as assistant text*, so they land
   in the transcript verbatim and `parser.rs::extract_protocol_message` /
   `parse_outcome_assessment` work unchanged against transcript-sourced text.

2. **Hooks for control signals.** Fleet installs Claude Code hooks
   (`SessionStart` / `Stop` / `PreToolUse` / `Notification`) routed to the in-app
   local HTTP server (`commands/fleet/hooks.rs`, `engine/hooks_sidecar.rs`). The
   `Stop` hook firing is a **clean, version-stable "turn complete" boundary** — it
   replaces the stream-json `result` line as the end-of-turn signal without parsing
   the TUI at all.

3. **Deterministic transcript location.** Fleet assigns `--session-id <uuid>` at
   spawn (`pty.rs:111`), so we know the exact `<uuid>.jsonl` to tail — no cwd
   guessing, no race.

**The design goal that makes this cheap downstream:** the PTY path emits the *same
internal `StreamLineType` event stream* the runner already consumes. The runner,
metrics accumulation, protocol dispatch, file-change extraction, and persistence all
stay unchanged. Only the *source* of those events changes — from "parse stdout
stream-json" to "tail transcript JSONL + react to hooks."

## 4. Goals / Non-goals

**Goals**

- A second execution transport, selectable by setting, that runs persona executions
  through interactive `claude` in a PTY on the subscription.
- Re-emit the existing `StreamLineType` stream so `engine/runner/*` is unchanged.
- Preserve the run result contract: assistant output, tool-use events, protocol
  messages, `outcome_assessment`, session id, model, and **cost/token metrics**.
- Reuse Fleet's PTY primitives and the existing transcript parser — minimal new
  surface.
- Stay dormant behind a flag until activated; zero behavior change until then.

**Non-goals**

- Replacing the `-p` path. `-p` stays the default while it works — it is cleaner and
  cheaper to maintain. Option C is the standby.
- TUI/ANSI screen scraping (explicitly rejected — see §3).
- A general "interactive sessions" product feature. This is an execution transport,
  not a UX.
- Defeating any future policy worded against all programmatic subscription use (out
  of scope — that's Option A/D territory).

## 5. Current path (what we're paralleling)

```
runner ── build_cli_args (cli_args.rs: "-p - --output-format stream-json …")
       └─ CliProcessDriver::spawn (cli_process.rs: piped stdin/stdout, kill_on_drop,
                                    force_subscription_auth)
            ├─ write prompt → stdin → close
            ├─ read stdout lines → parser::parse_stream_line → StreamLineType
            │      ├─ AssistantText / AssistantToolUse / ToolResult / TodoWrite
            │      ├─ protocol messages (extract_protocol_message_from_value)
            │      └─ Result { total_cost_usd, tokens, session_id, model, cache… }
            └─ on EOF: parse_outcome_assessment over accumulated text → terminal state
```

The `Result` line is the only place `total_cost_usd` arrives — that is the one piece
the transcript may not give us (see §6.5).

## 6. Proposed architecture

### 6.1 Execution mode is orthogonal to provider

`EngineKind` (`engine/provider/mod.rs`) answers "*which* CLI" (today only
`ClaudeCode`). Execution mode answers "*how* we drive it." Add a new dimension:

```rust
// engine/provider/mod.rs (or a sibling)
pub enum CliExecutionMode {
    Print,   // claude -p over piped stdio (current default)
    Pty,     // interactive claude in a PTY (this design)
}
```

Selected from settings (`db/settings_keys.rs`, e.g. `CLI_EXECUTION_MODE`), defaulting
to `Print`. This keeps the provider abstraction clean and lets a future non-Anthropic
provider also choose a transport.

### 6.2 `PtyExecutionDriver` — parallel to `CliProcessDriver`

A new driver under `engine/` (e.g. `engine/pty_process.rs`) that mirrors
`CliProcessDriver`'s lifecycle contract but over `portable-pty`. Lift the proven bits
from `commands/fleet/pty.rs`:

- `native_pty_system().openpty(...)`, `CommandBuilder`, Windows `claude.cmd`
  resolution (`locate_claude_cmd`), `clone_killer()` (interactive claude ignores
  stdin EOF — must be killed, see `pty.rs:223`), reader/reaper blocking tasks.
- **Auth:** set the same env as `pty.rs:213` (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`) and — critically — do **not** set any
  API-key env. Run `force_subscription_auth`-equivalent removals so the interactive
  session uses subscription OAuth. (This is already how Fleet behaves.)
- **kill_on_drop equivalent:** the cancellation/timeout/ceiling guarantees that
  `CliProcessDriver` gets from `kill_on_drop(true)` must be reproduced by holding the
  `killer` handle and killing on cancel/timeout/drop. Interactive claude will *not*
  exit on its own after a turn.

Differences from Fleet's spawn:
- Headless context (no xterm.js consumer). The reader task's job is not to forward to
  a UI but to (a) detect readiness and (b) be a liveness fallback. Primary output
  comes from the transcript, not the PTY byte stream.
- One driver instance per execution (one-shot mode) — see §6.6 for pooling.

### 6.3 Prompt delivery (the "typing" problem)

`-p` delivers the prompt on stdin then closes it. Interactive mode needs the prompt
"typed" into the PTY and submitted:

- Write the prompt bytes to the PTY master writer, then the submit keystroke
  (carriage return). **Spike required** on multi-line prompts: our prompts are large
  and multi-line, and a bare `\n` mid-prompt may submit early. Likely need
  **bracketed paste mode** (`ESC[200~` … `ESC[201~`) so the CLI treats the whole blob
  as one paste, then a separate submit `\r`.
- Confirm prompt-ready before sending: wait for first PTY output (Fleet promotes
  `Spawning → Idle` on first byte, `pty.rs:441`) or a readiness hook, with a timeout.
- Permission prompts: pass `--dangerously-skip-permissions` at launch (Fleet already
  does, `pty.rs:163`) so the session never blocks awaiting a human.

### 6.4 Turn-completion detection (no TUI parsing)

Use the **`Stop` hook** as the end-of-turn boundary:

- Install hooks for the execution session (reuse `commands/fleet/hook_install.rs` /
  `engine/hooks_sidecar.rs`). Bind by the known `--session-id`.
- The driver awaits a "Stop fired for `<session-id>`" signal (via the local HTTP
  server → an in-process channel keyed by session id), with a hard timeout that maps
  to the persona's existing `timeout_ms`.
- `PreToolUse` / tool hooks optionally give progress liveness (analogous to today's
  per-line streaming), but they are **not** required for correctness — the transcript
  is the source of truth for *what* happened; the `Stop` hook is the signal for
  *when it's done*.

Fallback if a hook is missed: the PTY reader's silence-tracker (cf. Fleet's
`note_pty_output` throttle, `pty.rs:447`) plus a transcript-quiescence check (no new
JSONL lines for N seconds after the last assistant block).

### 6.5 Output adaptation — transcript JSONL → `StreamLineType`

A new adapter (e.g. `engine/pty_transcript_adapter.rs`) tails the session transcript
and converts each new line into the existing `StreamLineType`, so the runner sees an
identical stream:

| Transcript line | Emit as |
|---|---|
| `{"type":"assistant",…"text"…}` | `StreamLineType::AssistantText` |
| `{"type":"assistant",…"tool_use"…}` | `AssistantToolUse` / `AssistantTodoWrite` |
| `{"type":"user",…"tool_result"…}` | `ToolResult` |
| assistant text containing protocol JSON | `extract_protocol_message_from_value` (unchanged) |
| (end-of-run, after `Stop`) | synthesize `Result { … }` |

The transcript already carries the assistant/user shapes `parser.rs` parses, so most
of `parse_stream_line` can be **reused directly** against transcript lines (refactor:
split `parse_stream_line` so the per-line match is callable on a `serde_json::Value`
from either source).

**The one real gap — `total_cost_usd`.** The CLI computes total cost and emits it
only in the stream-json `result` event, which has no transcript equivalent. Recovery
options, in preference order:

1. **Per-message usage in the transcript.** Assistant lines typically carry
   `message.usage` (input/output/cache tokens). **Spike #1:** verify these fields are
   present in interactive-session transcripts. If so, sum them and price with the
   existing model price table (`engine/cost.rs`) to *derive* `total_cost_usd` — the
   same number, computed by us instead of the CLI.
2. **A side `--output-format` channel.** Investigate whether interactive mode can be
   asked to also write structured usage somewhere (unlikely; spike).
3. **Accept token-only metrics** if cost can't be derived, and compute cost downstream
   from tokens + price table at display time. `ExecutionMetrics` already stores tokens
   separately from cost (`parser.rs::update_metrics_from_result`).

Option 1 is almost certainly viable and keeps `total_cost_usd` accurate. This is the
single most important spike before committing to the build.

### 6.6 Session lifecycle: one-shot vs pooled

- **One-shot (v1, simplest):** one PTY per execution. Spawn → type prompt → await
  `Stop` → read transcript → kill. Downside: interactive startup is heavier than `-p`
  (banner, hook scan); acceptable for v1.
- **Pooled (v2, optimization):** keep a warm interactive session per persona and send
  follow-up turns into the same PTY. This maps onto the existing `SessionPool`
  (`engine/session_pool.rs`) and the `--resume` continuation concept, but with a
  *live* process instead of a cold `--resume`. Bigger win on latency and prompt-cache
  warmth; more state to manage (one live child per pooled persona, idle eviction).
  Defer to v2.

### 6.7 Flag mapping (print-mode flags → interactive)

`build_cli_args` (`engine/prompt/cli_args.rs`) pins several flags. Each needs an
interactive equivalent or a decision to drop it. **Spike #2** confirms which the
interactive CLI honors at launch:

| `-p` flag | Interactive plan |
|---|---|
| `-p -` / `--output-format stream-json` / `--verbose` | **Dropped** — replaced by transcript tailing + hooks |
| `--dangerously-skip-permissions` | **Keep** (Fleet passes it at launch) |
| `--model <m>` | **Keep** — confirmed via Fleet-style launch arg |
| `--mcp-config <path>` | **Keep** — Fleet passes it (`pty.rs:173`) for Athena MCP |
| `--session-id <uuid>` | **Keep** — required for deterministic transcript path |
| `--exclude-dynamic-system-prompt-sections` | Spike — verify interactive honors it (prompt-cache win) |
| `--effort <level>` | Spike — may be `-p`-only; interactive equivalent may be env (`MAX_THINKING_TOKENS`) or `/model` |
| `--max-turns` / `--max-budget-usd` | Spike — likely `-p`-only; enforce app-side via timeout + our own budget tracking instead |
| env: `DISABLE_UPDATES`, `CLAUDE_CODE_HIDE_CWD`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`, prompt-cache removals | **Keep** — all env-based, transport-independent |

Budget/turn caps that don't survive as flags must move app-side: we already track
cost/tokens per run and own `timeout_ms`; `run_budget.rs` can enforce a ceiling
without the CLI flag.

### 6.8 Cancellation, timeout, resume, auth

- **Cancellation/timeout:** hold the `killer`; on cancel/timeout/ceiling-drop, kill the
  child (interactive claude ignores stdin EOF). Reproduce `CliProcessDriver`'s
  PID-registration so external cancel paths (`engine/runner/globals.rs` pid map) work.
- **Resume:** maps to launching with `--resume <session-id>` instead of a fresh
  `--session-id`; transcript continues in the same file. Mirrors
  `build_resume_cli_args` semantics.
- **Auth:** unchanged and central — subscription OAuth, no API-key env. The whole
  point.

## 7. Where it slots in (file map)

| New / changed | Role |
|---|---|
| `engine/provider/mod.rs` | add `CliExecutionMode` (+ settings read) |
| `db/settings_keys.rs` | `CLI_EXECUTION_MODE` key |
| `engine/pty_process.rs` *(new)* | `PtyExecutionDriver` — PTY lifecycle (lift from `commands/fleet/pty.rs`) |
| `engine/pty_transcript_adapter.rs` *(new)* | tail `<session-id>.jsonl` → `StreamLineType` |
| `engine/parser.rs` | refactor `parse_stream_line` to expose a `Value`-level entry reusable by the adapter |
| `engine/runner/mod.rs` | branch on `CliExecutionMode` to pick driver; **downstream unchanged** |
| `engine/hooks_sidecar.rs` / `commands/fleet/hook_install.rs` | reuse hook install + add a per-execution `Stop`-completion channel |
| `engine/cost.rs` | derive `total_cost_usd` from summed transcript token usage |
| `engine/session_pool.rs` | (v2) warm interactive-session pooling |

## 8. Open questions / spikes (ranked)

1. **[blocker] Does the interactive-session transcript carry per-message
   `message.usage` (tokens)?** Determines whether we can derive `total_cost_usd`
   (§6.5). Verify by spawning one interactive session and inspecting its `.jsonl`.
2. **[blocker] Which `build_cli_args` flags does interactive mode honor at launch?**
   Especially `--model`, `--exclude-dynamic-system-prompt-sections`, effort (§6.7).
3. **[high] Prompt submission for large multi-line prompts** — bracketed paste vs
   newline; does the CLI submit on `\r` reliably without truncating (§6.3)?
4. **[high] `Stop`-hook reliability as the sole completion signal** under our load —
   does it always fire once per turn for an automated session? Quiescence fallback
   design (§6.4).
5. **[med] Startup latency** of interactive vs `-p` per execution — quantify to decide
   if one-shot (v1) is acceptable or pooling (v2) is required from day one.
6. **[med] Transcript write-flush timing** — is the `Stop` hook guaranteed to fire
   *after* the final assistant line is flushed to the `.jsonl`? If not, add a short
   post-Stop read-settle window.

## 9. Rollout plan

1. **Spike (1–2 days, no production code):** answer §8.1 and §8.2 by hand-driving an
   interactive session and dumping its transcript + testing launch flags. Go/no-go on
   cost derivation. *This is the only step worth doing before activation is imminent.*
2. **Driver + adapter behind `CLI_EXECUTION_MODE=pty`,** defaulting off. One-shot
   lifecycle. Reuse Fleet PTY + transcript parser.
3. **Shadow mode:** run a sample of executions through *both* paths and diff the
   resulting `StreamLineType` streams + metrics. The `-p` path is the oracle; the PTY
   path must match (modulo derived-vs-reported cost rounding). This is the correctness
   gate.
4. **Opt-in cutover:** flip the default to `pty` only if/when an activation trigger
   fires. Keep `-p` selectable as instant rollback.
5. **(v2) Pooling** if latency demands it.

Steps 2–5 stay **dormant** until triggered. Only step 1 (the spike) is worth doing
proactively, so we know the path is real before we need it.

## 10. Activation triggers

Pull this off the shelf when any of:

- Anthropic re-announces moving `claude -p` / SDK off subscription rate limits **and**
  the wording still exempts interactive Claude Code.
- Our `-p` executions start drawing on a separate credit / surfacing
  "credit balance too low" (`engine/cli_process.rs` notes this symptom) despite
  subscription auth.
- A CLI release removes or meters `-p` for subscription accounts.

Do **not** pull it if the new policy covers *all* programmatic subscription use — then
go to Option A (API key) or Option D (non-Anthropic provider).

## 11. Alternatives considered

- **Option A — opt-in API key.** Sanctioned, robust, but pay-per-token kills the
  subscription economics at our volume. Last resort; keep as dormant insurance only.
- **Option B/D — non-Anthropic provider** via the `CliProvider` seam. Escapes the
  policy entirely but a real model-quality drop; resilience option, not parity.
- **Token extraction → direct API calls with the subscription OAuth token.**
  Rejected: ToS violation, fragile (rotation/detection), and exactly the programmatic
  subscription use the policy governs.
- **Pure TUI/ANSI scraping.** Rejected: brittle, version-fragile, throws away the
  structured transcript we already parse (§3).

## 12. What this design deliberately does not change

- The `-p` path stays the default and the maintained primary. This is a standby.
- `force_subscription_auth` and the API-key-stripping invariant are preserved and
  extended to the PTY path.
- The runner and all downstream consumers of `StreamLineType` are untouched — the
  adapter's job is to make the PTY path indistinguishable from `-p` to everything
  above the transport.

---

*Not wired into `companion/brain/doctrine.rs` (it's a contingency, not active
doctrine). If activated and shipped, move this doc under `docs/features/execution/`
per the concepts-folder doc-rule.*
