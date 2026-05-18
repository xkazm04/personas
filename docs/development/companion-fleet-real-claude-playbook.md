# Companion ↔ Fleet — real-claude verification playbook

How to eyeball-verify the Athena ↔ Fleet orchestration stack
(Directions 1–5 v2) against the *real* `claude` CLI, with you in the
loop.

The automated Playwright spec
(`tests/playwright/companion-real-claude-workflow.spec.ts`) covers
the headless smoke path. This playbook is for when you want to **see**
the orchestration happen in the UI — guidance cards landing, the
operative-memory digest filling out, the wrap-up rendering in the
chat panel.

## Prerequisites

- `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) configured in the
  environment so spawned claudes can authenticate.
- `claude` on PATH (or the appropriate shim — `claude.cmd` /
  `claude.ps1` on Windows; the spawn path picks the right one
  automatically).
- This worktree built and running:

  ```bash
  npm run tauri:dev:test           # exposes :17320 test-automation bridge
  # or in another shell
  npm run tauri:dev:test:full      # if you also want ML/p2p features
  ```

## Path A — Athena drives the dispatch (full meta-agent loop)

This is the user-facing happy path: you ask Athena, she proposes,
you approve, she watches.

1. Open Athena's chat (footer icon, or `/companion`).
2. Open Dev Tools → Fleet. Verify it's empty (or at least quiet).
3. Pick a small repo with no in-flight work — a sandbox checkout is
   easiest. Note its absolute path.
4. Tell Athena:

   > Use `fleet_dispatch` to spawn two sessions in
   > `<path>`: one named "inspector" that lists the files and
   > exits, one named "summarizer" that reads README.md and exits.
   > Keep both `--print` mode.

5. Athena emits an `OP: fleet_dispatch { ... }` block. An
   `ApprovalCard` appears in the chat with the role list. **Verify**
   the card shows both roles + the cwd.
6. Click **Approve**.
7. Watch Dev Tools → Fleet. Two sessions appear, named
   `athena-inspector` and `athena-summarizer`. Each transitions
   `Spawning → Running → Idle/Exited`.
8. When both reach `Exited`, the chat panel shows a *Reconciler*
   notice — one bubble per op carrying the cross-session wrap-up
   (intent, per-role bullets, files touched union).

**What you're verifying:** the full Tier-3 loop. One approval click
→ N sessions → one wrap-up. The reconciler synthesized cross-session
content, not just N stitched per-session summaries.

## Path B — Force dispatch via the test command (substrate only)

When Path A is too rich and you just want to confirm the dispatcher
+ reconciler substrate works. Bypasses Athena's chat.

1. With `tauri:dev:test` running, open a terminal and:

   ```bash
   curl -sS http://127.0.0.1:17320/bridge-exec \
     -H 'content-type: application/json' \
     -d '{
       "method": "invokeCommand",
       "params": {
         "command": "companion_test_fleet_dispatch",
         "params": {
           "params": {
             "operation_intent": "inspect a small repo",
             "role_specs": [
               { "role": "inspector",   "cwd": "<abs-path>", "args": ["--print", "list files; exit"] },
               { "role": "summarizer",  "cwd": "<abs-path>", "args": ["--print", "read README; exit"] }
             ]
           }
         }
       }
     }'
   ```

2. The response body's `result` is the human-readable confirmation
   ("Dispatched operation … across 2 session(s):").
3. Watch the operative-memory digest fill out:

   ```bash
   curl -sS http://127.0.0.1:17320/bridge-exec \
     -H 'content-type: application/json' \
     -d '{"method":"invokeCommand","params":{"command":"companion_get_operative_memory_digest","params":{}}}' \
     | jq -r '.result'
   ```

   Re-run every few seconds. Once both sessions exit, the digest
   line for the op flips from `active` → `completed` / `failed`.

## Path C — MCP-driven session (verify Athena tools)

For verifying that `--mcp-config` wiring works end-to-end and the
session can actually call `athena.report_intent` /
`athena.request_guidance`.

1. Single-session spawn via `fleet_spawn_session` (or from the
   Fleet UI in Dev Tools — same effect).
2. Athena's chat panel should already be visible.
3. In the spawned session, paste a prompt that explicitly asks
   claude to call the MCP tools:

   > Use the `athena.report_intent` tool to announce you're going to
   > inventory this directory, then use `athena.request_guidance` to
   > ask Athena which file to read first.

4. **Verify:**
   - Operative-memory digest gains the reported intent above the
     session's tool line.
   - Chat panel grows a guidance card with the question.
5. Answer in the card. Click Send.
6. **Verify:** the session unblocks and continues. The card
   disappears from the strip.

**What you're verifying:** the MCP transport (token header → axum
→ pending hub → Tauri event → frontend), the blocking RPC round-
trip (frontend resolve → oneshot → MCP response → session
unblocks), and the operative-memory `record_intent` path.

## Triage

- **Fleet UI shows no spawned sessions.** `local_http` server may
  not be bound. Check the dev console for `local_http server failed
  to bind`. If that fires, the per-session `mcp.json` is skipped (a
  warning logs to the Rust side) and `--mcp-config` isn't passed —
  Athena MCP tools won't be callable, but Fleet still works.
- **Guidance card never appears.** Check the dev console for
  `athena://mcp/guidance-request` events. If the event fires but the
  card doesn't render, the `useMcpRequestBridge` mount may be
  missing — confirm `PersonasPage.tsx` mounts it.
- **Reconciler doesn't fire.** Inspect the op's
  `dispatched_by_athena` flag via the digest (only Athena-dispatched
  ops reconcile). Ad-hoc ops from a manual `fleet_spawn_session`
  *do not* trigger the reconciler — they fall back to per-session
  summaries only.
- **Cargo test hangs.** The orchestration tests share a global
  `OperativeMemory` singleton; if you suspect a deadlock, run them
  single-threaded:
  `cargo test --features desktop --lib companion::orchestration -- --test-threads=1`.
