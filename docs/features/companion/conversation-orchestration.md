# Athena conversation orchestration — replacing long-pause-then-big-bang

**Status:** Proposal (research + 3 variants). Step 1 (remove the raw token stream) shipped.
**Author:** 2026-05-23
**Scope:** How Athena's chat turns surface intermediate state / effort to the UI and TTS, instead of a long silent pause followed by one big final message.

## The problem

A companion turn drives the `claude` CLI as a subprocess and can run for many seconds (tool calls, reasoning, connector jobs). Two bad shapes:

1. **The raw token stream** (now removed). We rendered `streamingText` token-by-token in the bubble. It reflowed constantly, leaked Athena's machine grammar (`OP:`/`QR:`/`TTS:` directives) before the server-side strip, and read as jittery. TTS couldn't use it (you can't speak half a token). Removed in this pass — the streaming bubble now shows a single status line (current phase, else "Thinking…") plus the `OperationalThread` checklist; the full prose lands in one piece when the turn finishes.
2. **Long pause → big bang.** With the stream gone, a slow turn is now "Thinking…" for 20s, then the whole answer at once (and the whole TTS summary at once). We want **graceful, substantive pacing** in between.

This doc inventories what the Claude Code CLI / Agent SDK actually expose for mid-turn observability (researched 2026-05-23 against current docs), then proposes three orchestration variants.

## Capability inventory (what the CLI/SDK give us mid-turn)

We consume `claude --output-format stream-json`. Relevant events (newline-delimited JSON, Anthropic SSE shapes):

- **`message_start` / `message_delta` / `message_stop`** — always emitted; `message_delta` carries `stop_reason` + token usage.
- **`content_block_start` / `content_block_delta` / `content_block_stop`** — require **`--include-partial-messages`** (we already pass this). Each block has an `index` and a typed body:
  - `text` block → `text_delta` (`{ delta: { type: "text_delta", text } }`) — the token stream we just stopped rendering.
  - `tool_use` block → `content_block_start` carries `{ content_block: { type: "tool_use", name, id } }`, then `input_json_delta` (`{ delta: { partial_json } }`) streams the arguments. **This is the high-value signal**: we know *which tool* (web_search, read file, a connector op) is starting, with its input, the instant it begins — real effort, not a guessed phase.
  - `thinking` block → `thinking_delta` (`{ delta: { type: "thinking_delta", thinking } }`) when reasoning is observable. Newer models may emit `display: "summarized"` (a thinking summary) or `"omitted"` (no thinking tokens, lower latency). **Verify what our pinned CLI/model actually emits** before relying on this.
- **Tool results** come back as `user`-role messages with `tool_result` content blocks, so we can show "…found 12 results" after a tool returns.
- **Hooks** (`PreToolUse` / `PostToolUse` / `Stop` / …) fire at lifecycle points but are **blocking decision points, not a streaming channel** — a hook can't push progress to the webview mid-turn except by side-channel (write a file / hit a local endpoint the UI polls). Lower-fidelity than parsing stream-json directly.
- **Compaction** (beta) may emit a `compaction_delta` when the server summarizes context — surfaceable as "Compacting conversation…" if our version supports it. Verify.
- **No built-in heartbeat.** There is no periodic "still working" event; the only liveness signals are the deltas above. (We already synthesize a soft/firm slow-progress chip at 30s/120s client-side.)

Today the backend parses CLI lines heuristically (`extractStreamPhase`) and reads `TodoWrite` tool calls into the `OperationalThread`. The structured `content_block_start: tool_use` events are a strictly better source for "what is she doing right now."

## Three variants

### Variant A — Event-driven live status (low effort, no model cooperation) ⭐ recommended first
Replace the heuristic phase with **real tool activity** parsed from `content_block_start: tool_use` + `tool_result`:

- On a `tool_use` start, map `name` (+ a little of `input`) to a human status: "Searching the web for *X*…", "Reading `runner.rs`…", "Calling Slack…". On `tool_result`, briefly show the outcome ("Found 12 results").
- Keep the `OperationalThread` (TodoWrite) as the persistent checklist; this variant upgrades the *transient* line above it from guessed → real.
- **TTS, sparingly:** speak only at tool *boundaries* (not per token) and only short, debounced phrases — e.g. one "Let me check that…" when the first tool fires, suppressed if the whole turn is fast (<~3s). Never speak partial tokens.

Pros: highest fidelity for least work; reuses our existing stream parser + OperationalThread; honest ("she's actually searching"). Cons: status granularity is bounded by how many tools a turn uses; a pure-reasoning turn still shows just "Thinking…".

### Variant B — Model-authored progress beats (medium effort, richest UX)
Teach Athena to **narrate** via a new structured op in her existing dispatcher grammar, e.g. `OP: progress { say: "Pulling up your recent runs…" }`. The backend flushes each beat to chat **and** TTS the instant it's parsed (not buffered to end-of-turn). One long reply becomes a sequence of short beats: acknowledge → intermediate finding → final answer.

Pros: natural conversational pacing; substantive (model decides what's worth saying); TTS plays short speakable lines as they arrive instead of one block at the end. Cons: needs prompt-engineering so Athena narrates without being chatty; backend must parse + flush beats incrementally (and de-dupe with the final summary); a misbehaving model could over- or under-narrate. Pairs naturally with A (A = automatic tool status, B = model's own words).

### Variant C — Instant acknowledge + heartbeat (low effort, guarantees no dead air)
Two-phase every turn: (1) an **immediate** spoken/written acknowledgment — templated ("On it — checking your fleet…") or a fast cheap-model call — so there is never silence at t=0; (2) the real turn runs and its final TTS summary plays when ready. Tie a **spoken** "still working" beat to the existing 30s/120s slow-progress timer.

Pros: trivial; eliminates dead air; works even for pure-reasoning turns with no tools. Cons: the "intermediate" content is generic filler, not real findings — it masks latency rather than informing.

## Recommendation

Ship **A** as the foundation (real, event-driven status; small change to the existing stream parser + phase source), layer **C** as a cheap always-on "no dead air" guarantee (instant ack + spoken heartbeat reusing the slow-progress timer), and treat **B** as the richer follow-up once A+C prove the pacing model. A+C need no model-behavior changes and no new protocol; B is where the conversation becomes genuinely multi-beat.

**Before implementing A/B:** confirm against the *pinned* CLI version what `content_block_*` / `thinking_delta` / `compaction_delta` events actually arrive (the inventory above is from current public docs; some are model/version-gated). The backend stream parser (`src-tauri/src/companion/session.rs`) and `extractStreamPhase` / `OperationalThread` are the integration points.

## Sources
Researched 2026-05-23 against: Claude API "Streaming messages", "Fine-grained tool streaming", "Extended thinking" / "Adaptive thinking", "Compaction"; Claude Agent SDK "Streaming output"; Claude Code "Hooks reference" + changelog. Treat version-gated specifics (adaptive thinking, compaction deltas, effort levels) as "verify on our pinned version" rather than guaranteed.
