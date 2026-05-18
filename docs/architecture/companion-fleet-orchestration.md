# Companion ↔ Fleet orchestration

How Athena (the in-app conversational agent) reasons over the Fleet (parallel
Claude Code worker subprocesses). The integration ships in three tiers; this
doc describes Tier-1 + Tier-2 *as currently implemented* and points at the
operative-memory layer (Directions 1 / 2 / 4) that landed afterwards.

## Two memory tiers, on purpose

| Tier | Where | Lifespan | Role |
|------|-------|----------|------|
| **Episodic / semantic / procedural** (`companion/brain/`) | SQLite + markdown on disk | Forever, by default | Long-term reflection. What *happened* and *why*. |
| **Operative memory** (`companion/orchestration/operative_memory.rs`) | In-process `RwLock<HashMap>` | Process lifetime | Working set. What's *happening right now* and *who's doing what for whom*. |

The split is deliberate. The brain accumulates a permanent record of decisions
and outcomes; operative memory is a kanban for live work. Polluting episodic
with every tool-call would bloat retrieval and hide the signal in noise.

## Data flow per fleet event

```
Fleet emits a hook → /fleet/hooks/<event> (axum, in-app on 127.0.0.1)
       │
       ├── Lifecycle events (SessionStart, Notification, Stop, SessionEnd):
       │   └── apply_hook() → registry state machine
       │       └── emit FLEET_SESSION_STATE event to webview
       │           └── useFleetCompanionBridge.ts hook (in PersonasPage)
       │               └── invoke companion_record_fleet_event
       │                   ├── episodic write (System episode w/ markers)
       │                   └── operative_memory.record_session_event
       │
       └── Tool events (PreToolUse, PostToolUse):
           └── operative_memory.record_tool_event   ← direct Rust path, no JS roundtrip
               (volume-heavy; ~10/min/session; skipping the JS layer matters)
```

Why two paths instead of one? Tool events fire at sub-second cadence per
session — multiply by 5–10 parallel sessions and the JS roundtrip becomes
visible. Lifecycle events are sparse and benefit from going through the
bridge (the bridge also writes to episodic, which tool events should *not*
do).

## What Athena sees

A live digest is appended to her prompt every turn, after the observability
section. It looks like:

```
## Active orchestration (operative memory)
- **add tests for login flow** (`op_3f2a8b1c`, active, started 4m ago)
  - `c9834933` "tests-a": working → Edit src/login/tests.ts
    files: src/login/tests.ts
  - `7964f596` "tests-b": awaiting input → Bash: npm test
    files: src/login/utils.ts, src/login/utils.test.ts
    ⚠ recent failure: expected token "}", found ";" at line 42
```

Compare to the pre-orchestration version:

```
## Active Fleet (Claude Code sessions)
2 sessions live — 1 awaiting input · 1 working · 0 idle · 0 stale · 0 spawning.
- `c9834933` (personas): working
- `7964f596` (personas): awaiting input
```

The new version tells Athena what each session is *doing* (tool + files), what
project intent it serves, what failed. It's the difference between "your three
sessions are running" and "your tests-a session is working on Edit src/login/tests.ts;
tests-b's last npm test failed with a syntax error".

## Operation lifecycle

- **User-initiated spawn:** Fleet creates a session → first hook arrives →
  operative memory auto-creates an Operation tagged
  `user spawn in <project>`. Ad-hoc operations are first-class — the user
  doesn't have to declare intent for their work to be tracked.
- **Athena-initiated dispatch (Tier-3, future):** Athena calls
  `fleet_spawn` with `{operation_id, role}`. Direction 5 builds on this;
  for now `OperativeMemory::begin_operation` exists but isn't wired
  through the dispatcher.
- **Completion:** every session in an Operation reaches `Exited` →
  Operation marked Completed. If any session exits non-zero, the
  Operation escalates to Failed.
- **TTL:** Completed/Failed operations stay in memory for 1h, then prune
  on the next `digest_for_prompt` call. They linger in the digest itself
  for only 5 minutes after completion so Athena can talk about
  "what just finished" without seeing the same op forever.

## Direction 4 — synthesized session-end summary (v1)

When a session reaches Exited, `synthesize_session_summary` runs *before*
the episode write. It reads accumulated operative-memory state for that
session and produces:

```
Ran for 4m — ended with a non-zero exit. Files touched: src/login/tests.ts,
src/login/utils.ts. Last failure tail: expected token "}", found ";"
```

The brain bridge then writes the Exit episode with this summary as the
body (machine-grep markers still on the first line). Athena's retrieval
now finds *work content* instead of lifecycle stamps.

v1 is built from operative-memory data only — no extra LLM call. A later
iteration may spawn a one-shot `claude --print --json-schema` against the
session's JSONL transcript for a richer narrative; v1 already gives Athena
far more signal than the bare lifecycle marker.

## Tier-2 dispatcher actions

Four actions Athena can propose, each gated by an ApprovalCard:

| Action | Effect | Risk |
|--------|--------|------|
| `fleet_send_input { session_id, text, press_enter? }` | Write to one PTY stdin | Local; reversible |
| `fleet_broadcast { target, text, press_enter?, ids? }` | Write to many | Local; reversible |
| `fleet_kill { session_id }` | Soft kill via PTY EOF | Local; ends a session |
| `fleet_spawn { cwd, args?, cols?, rows? }` | Spawn new claude | Cost-bearing |

Spawn auto-tags the new session with the visible name `"athena"` as a
recursion guard sentinel — Direction 5's proactive evaluator will grow
a "skip nudges for athena-named sessions" branch so she doesn't nudge
herself in a loop.

## What's coming (Directions 3 + 5)

- **Direction 3 — Athena as MCP server.** Sessions discover Athena via
  `--mcp-config` and invoke tools (`athena.report_intent`,
  `athena.checkpoint`, `athena.request_guidance`,
  `athena.request_approval`). Replaces hook-scraping with a structured
  RPC surface.
- **Direction 5 — `fleet_dispatch` with reconciliation.** One ApprovalCard
  fans out N sessions under one Operation; Athena's autonomous loop polls
  the reconciliation context, synthesizes per-session outcomes into a
  single wrap-up message. The full meta-agent loop.

Both build on the operative-memory layer landed here — they're refinements,
not replacements.

## Test surface

- **Rust unit tests** (`operative_memory.rs::tests`, 8 cases):
  ad-hoc op creation, state transitions, tool-event mapping, failure
  tail capture, summary synthesis, digest formatting, completion
  detection. Run with `cargo test --features desktop --lib operative_memory`.
- **Vitest** (`useFleetCompanionBridge.test.tsx`, 6 cases): event-to-payload
  mapping, race protection, debounced added path.
- **Playwright** (`companion-fleet-orchestration.spec.ts`, 3 cases):
  digest exposed via `companion_get_operative_memory_digest`; exited
  events produce synthesized-summary episode bodies; non-zero exits
  flip operations to Failed in the digest.

## Sharp edges

- **Operative memory is process-lifetime only.** Restart → clean slate. By
  design, but be aware: the synthesized summary in episodic memory is the
  durable record.
- **Tool events use Rust-direct path** to skip the JS roundtrip. Means
  the frontend's `useFleetCompanionBridge` does NOT see tool events; only
  lifecycle. If you ever wire tool events into a frontend store, route
  via Tauri event from the hook receiver — don't try to read operative
  memory from JS (it's not exposed).
- **Failure detection looks at `exit_code` and `error_message` only.**
  A successful command that prints `ERROR:` to stdout won't flag. The
  hook-payload contract (PostToolUse with structured fields) defines
  what's reachable; richer parsing would be possible but adds heuristic
  fragility for marginal gain.
- **Ad-hoc operations multiply.** Each unrelated user spawn in the same
  project creates a new ad-hoc op (deliberate — the user thinks of them
  as separate tasks). After many spawns, the digest could get noisy;
  the 5-minute "keep recent" window on completed ops bounds this in
  practice.
