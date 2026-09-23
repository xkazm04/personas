# Athena and the hybrid LLM engine

> Research, measurements and the decision record for the question "can Athena switch
> between the Grok CLI and the Claude CLI, or combine them: Grok for fast chat and voice,
> Claude for the orchestration behind?" Measured 2026-09-17 on the operator's machine
> (Windows 11, `grok` 1.0.34 logged in through grok.com, `claude` 2.1.274 on a
> subscription seat). Every number below carries its n; none is a universal constant.

## Short answer

1. **Switching or combining is feasible.** Grok Build's headless mode emits the same
   stream-json envelope Athena's stream already forwards (`system/init` with a session id,
   `stream_event` deltas, `assistant`, a terminal `result` with usage and cost). An agent
   profile file carries the full 148 KB Athena prompt, `--resume` works headless, and the
   production dispatcher parsed Grok's replies at near parity (20 of 22 scenarios, versus
   21 of 22 for today's Opus tier). A Grok lane is a one-package change on the pattern the
   fleet's codex lane already uses.
2. **"Grok for fast chat and voice" is falsified as measured.** Under the prompt Athena
   actually sends, Grok reaches the first visible token 3.4 times later than today's
   Opus-low tier (11.4 s versus 3.4 s at p50; 45.6 s versus 4.2 s at p90). Grok Build does
   not prompt-cache across spawns, carries a fixed scaffold of about 16k tokens, and is
   metered on the grok.com login where Claude rides the seat. Even a warm, cached Grok
   session needs about 11 s for "haha nice, thanks".
3. **What the numbers say is fast lives in the Claude path:** a warm Sonnet 5 session
   (about 2 s to first text on turn two and later) and a small prompt (the 6.7 KB bench
   fixture reaches first text in 2.9 s where the 148 KB constitution takes 5.0 s on the
   same model). The constitution is six times over its own declared 24k-character budget.
4. **"Claude for orchestration behind" already exists structurally.** Athena's ops
   dispatch fleet workers that are `claude` (or `codex`) headless sessions. The only
   engine choice the hybrid actually opens is Athena's own interactive turn.

## How an Athena turn runs today

One `claude.exe` process per turn (`src-tauri/src/companion/session/cli.rs`): `-p -`,
`--output-format stream-json --verbose --include-partial-messages`,
`--dangerously-skip-permissions --exclude-dynamic-system-prompt-sections`, `--model`
from the MAIN tier (`claude-opus-5`, effort `low`, `model_routing.rs`), the composed system
prompt in a temp file passed as `--system-prompt-file`, `--resume <id>` when the
conversation has a pointer, the user message on stdin. The whole prompt is re-sent every
turn; `--resume` is continuity, not the context source. Every stdout line is forwarded
raw to the UI as `companion://stream`; the server reads only the session id, the
assistant text blocks and the terminal `result`. Ops (`OP: {json}`, `QR:`, `TTS:`,
`PROGRESS:`) are a text grammar the dispatcher parses on the finalized text, so the
contract is transport-agnostic. Voice is the same path: speech input becomes the same
send, and the reply itself is spoken (layer one is the spoken register; an optional `TTS:`
line replaces it only when the visible reply must differ from speech; see
`docs/features/companion/layered-voice.md`). No
spawn-to-first-token measurement existed before this work.

## Grok CLI 1.0.34, as measured

| Capability | Finding |
| --- | --- |
| Headless turn | `grok -p "<msg>" --tools "" --max-turns 1 -m grok-4.6 --effort low --output-format streaming-messages-json --include-partial-messages` |
| Stream shape | The Claude stream-json envelope, including `thinking_delta`, `text_delta`, `assistant`, `result` with `usage` and `total_cost_usd` |
| System prompt | `--system-prompt-override` is argv-only (150 KB fails with `ENAMETOOLONG` on Windows) and did not reduce input tokens; `--agent <profile.md>` (frontmatter + body) carries the full prompt |
| Fixed overhead | About 16k input tokens of Grok Build scaffold even with a one-line profile; 52,974 tokens with the Athena prompt |
| Prompt caching | Effectively none across spawns (128 to 256 cached tokens per turn); a persistent `grok agent stdio` session does cache (53k to 58k) |
| Continuity | `--resume <uuid>` and `--session-id` work headless (codeword round-trip passed) |
| Effort | `low`, `medium`, `high`, `xhigh`; `none` is rejected despite the README |
| Persistent session | `grok agent [options] stdio`, ACP JSON-RPC (`initialize`, `session/new`, `session/prompt`, `agent_message_chunk` updates); about 0.4 s boot plus 3 s for `session/new` |
| Config isolation | Reads `~/.claude/settings.json` hooks, `~/.claude/skills` and `.mcp.json`; the operator's SessionEnd hook fired inside Grok and posted to the fleet bridge |
| Models on this login | `grok-4.6` (default, effort xhigh), `grok-4.5` |

## Measurements

Harness: a copy of the spawn and scoring path of `scripts/test/athena-model-bench.mjs`,
scored by the production dispatcher through `athena-bench-validate`; cold-spawn and
persistent-session probes alongside. Raw rows live with the spark's session material.

### Cold spawn, trivial prompt, no tools (ms to first visible text, 3 reps)

| Configuration | First text |
| --- | --- |
| grok-4.6 low, default profile | 2.8k, 3.8k, 3.7k |
| grok-4.6 low, `--system-prompt-override` | 2.7k, 6.8k, 10.7k (cache lost) |
| grok-4.5 low | 5.2k, 10.0k, 3.0k |
| claude haiku 4.5 (thinks by default) | 7.3k, 14.1k, 5.4k |
| claude sonnet 5 | 5.3k, 4.9k, 5.3k |

Grok wins the trivial cold spawn by about 2 s at the median, with three times the variance.

### Warm persistent session, trivial prompts, turns two and three (ms to first text)

| Configuration | Turn 2 | Turn 3 |
| --- | --- | --- |
| grok-4.6 low, ACP stdio | 4.5k, 2.9k | 4.1k, 9.1k |
| grok-4.5 low, ACP stdio | 12.8k | 10.1k |
| claude sonnet 5, `-p --input-format stream-json` | 1.9k, 2.6k | 2.0k, 2.6k |
| claude haiku 4.5, same | 5.3k, 3.4k | 3.4k, 3.7k |

### Athena scenarios, spawn per turn as `cli.rs` does, scored by the dispatcher

Eleven scenarios (eight on the 6.7 KB bench fixture prompt, one per decision class plus
two; three on the real 148 KB constitution plus identity), two reps, three cells.

| Cell | Prompt | Pass | First text p50 / p90 | Total p50 / p90 | Prompt tokens p50 | Cached p50 |
| --- | --- | --- | --- | --- | --- | --- |
| grok-4.6 low | fixture | 15/16 | 5.6 s / 11.2 s | 10.0 s / 16.0 s | 17.8k | 256 |
| grok-4.6 low | real | 5/6 | 11.4 s / 45.6 s | 14.3 s / 49.6 s | 53.2k | 128 |
| claude-opus-5 low (MAIN today) | fixture | 15/16 | 3.0 s / 3.6 s | 5.5 s / 6.5 s | 19.3k | 13.9k |
| claude-opus-5 low | real | 6/6 | 3.4 s / 4.2 s | 5.2 s / 5.7 s | 70.0k | 64.5k |
| claude-sonnet-5 low | fixture | 16/16 | 2.9 s / 4.3 s | 5.2 s / 7.6 s | 25.2k | 19.6k |
| claude-sonnet-5 low | real | 6/6 | 5.0 s / 6.2 s | 7.0 s / 7.6 s | 75.8k | 75.8k |

Failures: `gated-update-dev-goal` once each on Grok and Opus (both emitted
`update_goal_status` instead of `update_dev_goal`, a corpus naming gap rather than an
engine defect); Grok on the real prompt described the Sentry pull in prose and emitted
no `OP:` line, the "promise without action" failure the v2 corpus was written against.

### Grok warm session with the real Athena profile (two sessions, three turns)

Turn one (a Sentry ask): 21.9 s and 49.6 s to first text, because Grok went agentic with
its own file tools looking for "the Sentry connector". Turn two (small talk): 11.3 s and
11.9 s with 53k to 58k tokens served from cache. Turn three (spoken summary): 83.3 s and
34.6 s. The session cache works; prefill of a 55k-token context still costs about 11 s at
effort `low`.

## Decision record

Design converged in two waves of operator questions on 2026-09-17; every recommendation
was accepted.

- **Direction:** an engine seam plus a Grok lane plus the Claude latency levers. Athena
  gets a real per-tier engine, model and effort setting; Grok ships as a selectable
  engine labelled slower and metered. Rejected: levers only with Grok parked; Grok behind
  an env var only; the hybrid as imagined despite the numbers.
- **Levers, all four:** a warm per-conversation session for interactive MAIN-tier turns
  (idle horizon 20 minutes, under the one-hour cache); a chat-class prompt family under
  the 24k-character budget built from a hand-written core plus an op reference generated
  from the dispatcher catalog, gated by the 38-scenario bench (no class may drop more than
  two points; restraint and gated discipline hard-fail); speech that starts on the first
  streamed sentence with the `TTS:` line becoming optional; spawn-to-first-token recorded
  per turn beside the CLI's own duration.
- **Setting home:** Settings > Engine > Athena tiers, persisted per tier as
  `companion.tier.<main|aside|micro>.<engine|model|effort>`. Rejected: env-only; a
  per-conversation switch, which would swap the model under a shared context.
- **Class, not surface:** chat and voice are one class (interactive MAIN). The registry's
  model-routing standard holds: one call, one class; the class travels into the record;
  never swap the model under a shared cached context; prefer a small prompt family over a
  small model.
- **Named member, not the persona enum:** Athena's `AthenaEngine {Claude, Grok}` stays
  separate from the persona execution `EngineKind`, as the fleet's codex lane token does.
- **Auth:** Grok uses its own login; Personas holds no xAI key.
- **Defaults unchanged:** MAIN opus-5 low, ASIDE sonnet-5 medium, MICRO sonnet-5 low. The
  1,026-turn calibration stands; n of 6 here is not a re-measure.

## Risks carried into the build

- Grok inherits the operator's `~/.claude` hooks and skills; the lane runs with
  `--tools ""` and cwd at home, but hooks still fire. Nothing in 1.0.34 documents a way to
  disable the Claude-compat discovery.
- The stream-json `control_request` interrupt on a warm Claude session was unverified at
  design time; the fallback is kill plus `--resume`.
- The chat prompt family may lose op accuracy; the bench gate is the guard. If it does
  not certify, the family ships behind `PERSONAS_ATHENA_PROMPT_CLASS=chat` only.
- On a warm session the per-turn dynamic context moves from the system prompt into the
  user message so the cached prefix stays byte-stable; recall quality on that path needs
  a bench appendix check.

## Related

- `docs/features/companion/athena-architecture.md` for the runtime, argv per engine, the
  tier table and the ledger columns.
- `docs/features/companion/README.md` for the settings surface and the voice behaviour.
- `scripts/test/athena-model-bench.mjs` for the bench cells, including the Grok cells.
