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

## Direction 3 — Athena as MCP server

Hooks are passive — they fire when claude does something and we infer
what's going on. With MCP, the session **tells** us, and Athena can
answer back synchronously.

### Transport

JSON-RPC 2.0 over HTTP, mounted as `/mcp/rpc` on the existing
`local_http` axum server. Same port as `/fleet/hooks/*` — no new
listener, no new port to discover. The server speaks the MCP
`initialize` / `tools/list` / `tools/call` /
`notifications/initialized` handshake.

### Session identity

Every spawned claude gets a per-session UUID token, minted at PTY
spawn time by `mcp::mint_session_token(fleet_session_id)` and written
into a per-session `mcp.json` under `<TMP>/fleet-mcp-<id>/mcp.json`:

```json
{
  "mcpServers": {
    "athena": {
      "type": "http",
      "url": "http://127.0.0.1:<local_http_port>/mcp/rpc",
      "headers": { "X-Athena-Session": "<token>" }
    }
  }
}
```

PTY spawn injects `--mcp-config <path>` into the claude argv. Every
MCP tool call carries the `X-Athena-Session` header; the dispatcher
resolves the token → Fleet session id. The PTY reaper releases the
token + cancels any pending blocking RPCs + removes the temp dir on
session exit.

### Tools

| Tool | Effect | Blocking |
|------|--------|----------|
| `athena.report_intent { intent, role?, operation_id? }` | Set SessionRef.intent + optional role; upgrade ad-hoc op label, or join an explicit op | No |
| `athena.checkpoint { progress, blockers? }` | Append a `Checkpoint` (capped at 20 per session, oldest rolls off) | No |
| `athena.request_guidance { question, context? }` | Emit `athena://mcp/guidance-request`; block until frontend resolves with `{ text }` | **Yes** |
| `athena.request_approval { action, rationale, details? }` | Emit `athena://mcp/approval-request`; block until frontend resolves with `{ approved, note? }` (denied → `isError: true`) | **Yes** |

The two blocking tools use a process-wide `PendingHub`
(`oneshot::Sender` registry, TTL 10m) that the frontend resolves via
`companion_mcp_resolve_request(request_id, response)`. On session
exit the hub cancels every pending entry for that session so the
blocking RPC returns with an `exited` error instead of hanging until
TTL.

### Coexistence with hooks

Hooks stay — they're cheap and cover the legacy path. When both fire
for the same effect (e.g. PreToolUse + a near-simultaneous
`checkpoint`), MCP wins for intent fidelity; hooks for tool granularity.

### Frontend

`useMcpRequestBridge` (mounted in `PersonasPage` alongside
`useFleetCompanionBridge`) listens for the two `athena://mcp/*-request`
events and seeds the `mcpRequestStore` Zustand store. A hard reload
also fetches `companion_mcp_pending_snapshot` so pending requests
survive a remount. `McpRequestPanel` (inside `CompanionPanel`,
pinned above proactive nudges since the session is blocked until the
user replies) renders one inline card per pending request.

## Direction 5 v2 — `fleet_dispatch` with cross-session reconciler

One ApprovalCard, N sessions under one Operation, one synthesized
wrap-up.

### Action

`fleet_dispatch` is in the dispatcher's `ALLOWED_ACTIONS` like the
other Tier-2 actions. Params:

```json
{
  "operation_intent": "add tests for login flow",
  "role_specs": [
    { "role": "writer", "cwd": "C:/path/to/proj", "args": [], "cols": 120, "rows": 32 },
    { "role": "runner", "cwd": "C:/path/to/proj", "args": [], "cols": 120, "rows": 32 }
  ]
}
```

Capped at 8 sessions per op to bound the blast radius of a runaway
dispatcher. When the user approves:

1. `OperativeMemory::begin_dispatched_operation(intent)` mints an op
   with `dispatched_by_athena = true`.
2. For each `role_spec`: `pty::spawn_session` →
   `attach_session_to_operation` (so the SessionRef lands on the op
   immediately, not on first hook) → `registry.rename(id, "athena-<role>")`
   for the recursion-guard sentinel + visible role tag.
3. The approval card shows the count + per-role list so the user
   can verify before clicking Approve.

### Reconciler

Lives in `commands/companion/fleet_bridge.rs::reconcile_if_dispatched`.
Fires inline at the end of every `companion_record_fleet_event`
exit-event path:

```
session exits → find_operation_for_session → snapshot_operation
  → if op.dispatched_by_athena AND op.status in {Completed, Failed}
       AND op.completion_summary is None:
     synthesize_operation_summary → write System episode
       → emit `athena://orchestration/operation-completed`
```

Idempotency comes from the `completion_summary.is_none()` guard — a
duplicate Exited event just no-ops. The synthesized wrap-up has:

- Op-level status line (intent + outcome + N exited / M failed)
- Per-session bullet: short id + role + state + intent + last
  summary OR last checkpoint, with failure tail if any
- Union of files touched across all sessions — Athena can spot
  "two sessions both edited utils.ts" patterns

The episode body uses marker tokens
`fleet-orchestration op:… state:op_{completed,failed}` so retrieval
finds it the same way per-session summaries land.

### Recursion guard

The proactive evaluator's existing
`"skip if session name == 'athena'"` branch covers single-spawn
recursion. For dispatch, `operation.dispatched_by_athena` gives a
second signal: the evaluator can skip any session belonging to such
an op, no matter what its visible name is.

## Test surface

- **Rust unit tests** (`operative_memory.rs::tests` + `mcp::*::tests`,
  26 cases total): ad-hoc op creation, state transitions, tool-event
  mapping, failure tail capture, summary synthesis (per-session AND
  cross-session), digest formatting, completion detection, MCP token
  round-trip, pending hub submit/resolve/cancel/snapshot, tool
  descriptors, intent record (ad-hoc upgrade + dispatched-op preservation),
  checkpoint cap, full dispatched lifecycle. Run with
  `cargo test --features desktop --lib companion::orchestration`.
- **Vitest** (`useFleetCompanionBridge.test.tsx` + `useMcpRequestBridge.test.tsx`,
  12 cases): event-to-payload mapping, race protection, debounced added
  path, MCP snapshot seed, guidance + approval live events, dedup,
  resolve round-trip.
- **Playwright** (`companion-fleet-orchestration.spec.ts`, 3 cases):
  digest exposed; exited events produce synthesized-summary episode
  bodies; non-zero exits flip ops to Failed.
- **Real-claude E2E** (`companion-real-claude-workflow.spec.ts`,
  gated by `RUN_REAL_CLAUDE_TESTS=1`): spawns 2 real claude sessions
  via `fleet_dispatch` against a temp hello-world repo, polls until
  the reconciler stamps a terminal status, asserts the wrap-up names
  both roles. Manual playbook for the human-in-the-loop version lives
  at [`docs/development/companion-fleet-real-claude-playbook.md`](../development/companion-fleet-real-claude-playbook.md).

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
- **MCP session identity is per-spawn**, not per-claude-session-id.
  Token → `fleet_session_id` mapping. If a future feature reuses a
  PTY across Claude Code reincarnations (it doesn't today), we'd
  need to either re-mint a token per `SessionStart` hook or move
  identity onto the claude_session_id.
- **Blocking MCP RPC + frontend disconnection.** If the chat panel
  is never opened, a `request_guidance` call hangs for the 10-minute
  TTL and the session waits with it. Mitigation: the TTL eventually
  fires and returns an `expired` error so the session can fall
  through, and the bridge fetches `pending_snapshot` on mount so a
  late-opened panel still sees the question. The bigger fix —
  decay-aware timeout based on session activity — is a future v2.
- **Dispatched operations bypass proactive nudge gating** for the
  whole op, not just per-session. If you wire the proactive
  evaluator to react to one of these sessions, route it through the
  `dispatched_by_athena` check on the parent op or accept that
  Athena will see herself nudging.
